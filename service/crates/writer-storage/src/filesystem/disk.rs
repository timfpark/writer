//! File system primitives: the data folder's layout, file identity, atomic
//! writes, stable reads, and directory listings. Every call is blocking and
//! runs inside one `spawn_blocking` task per operation.

use std::fs::{self, File, Metadata};
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;
use unicode_normalization::UnicodeNormalization;
use writer_domain::{ItemId, ItemKind};

use super::names;

pub(crate) const WORKSPACE_DIR: &str = "workspace";
pub(crate) const META_DIR: &str = ".writer";
pub(crate) const TMP_DIR: &str = "tmp";
pub(crate) const TRASH_DIR: &str = "trash";
const INDEX_FILE: &str = "workspace.json";
const LOCK_FILE: &str = "lock";
/// How many times a read starts again when the file changes during it.
const STABLE_READ_ATTEMPTS: usize = 5;

/// Where the backend keeps the workspace and its own files.
pub(crate) struct Disk {
    pub data: PathBuf,
    pub root: PathBuf,
    pub meta: PathBuf,
    pub tmp: PathBuf,
    pub trash: PathBuf,
    pub index: PathBuf,
    pub lock: PathBuf,
    #[cfg(test)]
    pub faults: std::sync::Arc<super::faults::Faults>,
}

impl Disk {
    pub fn new(data: PathBuf) -> Self {
        let root = data.join(WORKSPACE_DIR);
        let meta = root.join(META_DIR);
        Self {
            tmp: meta.join(TMP_DIR),
            trash: meta.join(TRASH_DIR),
            index: meta.join(INDEX_FILE),
            lock: meta.join(LOCK_FILE),
            meta,
            root,
            data,
            #[cfg(test)]
            faults: Default::default(),
        }
    }

    /// The absolute path of names relative to the workspace root.
    pub fn abs(&self, relative: &[String]) -> PathBuf {
        let mut path = self.root.clone();
        path.extend(relative);
        path
    }

    /// A point at which a test can make the next step fail or the process
    /// stop. It does nothing outside tests.
    pub fn step(&self, name: &'static str) -> io::Result<()> {
        #[cfg(test)]
        {
            self.faults.hit(name)
        }
        #[cfg(not(test))]
        {
            let _ = name;
            Ok(())
        }
    }
}

/// A file's identity, which survives renames: its device and inode on Unix.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FileIdentity {
    pub device: u64,
    pub inode: u64,
}

#[cfg(unix)]
pub(crate) fn identity(meta: &Metadata) -> FileIdentity {
    use std::os::unix::fs::MetadataExt;
    FileIdentity {
        device: meta.dev(),
        inode: meta.ino(),
    }
}

/// Windows has no stable file index in the standard library; the creation
/// time stands in until Windows becomes a supported host.
#[cfg(not(unix))]
pub(crate) fn identity(meta: &Metadata) -> FileIdentity {
    let created = meta
        .created()
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_nanos() as u64);
    FileIdentity {
        device: 0,
        inode: created,
    }
}

/// Makes a directory's entries, including renames into or out of it,
/// survive power loss. Windows offers no directory sync.
pub(crate) fn sync_dir(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

/// A temporary file in `.writer/tmp/` holding `bytes`, synced to stable
/// storage, with the permissions of `like` or the process's default.
pub(crate) fn temp_file(
    disk: &Disk,
    bytes: &[u8],
    like: Option<&Metadata>,
) -> io::Result<NamedTempFile> {
    let mut builder = tempfile::Builder::new();
    builder.prefix("write-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // The umask applies, as it does to any new file.
        builder.permissions(fs::Permissions::from_mode(0o666));
    }
    let mut file = builder.tempfile_in(&disk.tmp)?;
    if let Some(like) = like {
        fs::set_permissions(file.path(), like.permissions())?;
    }
    file.write_all(bytes)?;
    disk.step("temp.sync")?;
    file.as_file().sync_all()?;
    Ok(file)
}

/// Replaces `target` with `bytes` so a reader sees the old or new file and
/// an acknowledged write survives power loss on Linux and macOS.
pub(crate) fn write_atomic(disk: &Disk, target: &Path, bytes: &[u8]) -> io::Result<()> {
    let existing = match fs::metadata(target) {
        Ok(meta) => Some(meta),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    let file = temp_file(disk, bytes, existing.as_ref())?;
    disk.step("write.rename")?;
    file.persist(target).map_err(|error| error.error)?;
    disk.step("write.sync")?;
    sync_dir(parent(target))
}

pub(crate) fn parent(path: &Path) -> &Path {
    path.parent().unwrap_or(path)
}

/// Why a document's bytes could not be read.
pub(crate) enum ReadFailure {
    /// No regular file is at the path.
    Missing,
    /// Another program kept changing the file.
    Unstable,
    Io(io::Error),
}

type Stamp = (FileIdentity, u64, Option<SystemTime>);

fn stamp(path: &Path) -> Result<Stamp, ReadFailure> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => Ok((identity(&meta), meta.len(), meta.modified().ok())),
        Ok(_) => Err(ReadFailure::Missing),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Err(ReadFailure::Missing),
        Err(error) => Err(ReadFailure::Io(error)),
    }
}

/// Reads a file whose identity, size, and modification time are the same
/// before and after the read, so the bytes come from one version.
pub(crate) fn read_stable(path: &Path) -> Result<Vec<u8>, ReadFailure> {
    for _ in 0..STABLE_READ_ATTEMPTS {
        let before = stamp(path)?;
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(ReadFailure::Missing);
            }
            Err(error) => return Err(ReadFailure::Io(error)),
        };
        if stamp(path)? == before {
            return Ok(bytes);
        }
    }
    Err(ReadFailure::Unstable)
}

/// A directory's entries that can be items, and how many it skipped.
pub(crate) struct Listing {
    pub entries: Vec<(String, ItemKind)>,
    pub skipped: usize,
}

/// Lists a directory without following anything: hidden names, symbolic
/// links, names that are not UTF-8, and files without `.md` are skipped.
pub(crate) fn list(dir: &Path) -> io::Result<Listing> {
    let mut listing = Listing {
        entries: Vec::new(),
        skipped: 0,
    };
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else {
            listing.skipped += 1;
            continue;
        };
        if name.starts_with('.') {
            listing.skipped += 1;
            continue;
        }
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            listing.entries.push((name, ItemKind::Folder));
        } else if file_type.is_file() && names::is_markdown(&name) {
            listing.entries.push((name, ItemKind::Document));
        } else {
            listing.skipped += 1;
        }
    }
    Ok(listing)
}

/// The identity of the entry at `path`, comparing its name with the
/// directory's entries case-sensitively after NFC normalization, so a
/// case-insensitive file system cannot report a different-case name as
/// present.
pub(crate) fn present(path: &Path) -> io::Result<Option<FileIdentity>> {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return Ok(None);
    };
    let wanted: String = name.nfc().collect();
    let entries = match fs::read_dir(parent(path)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let matches = entry
            .file_name()
            .to_str()
            .is_some_and(|actual| actual.nfc().eq(wanted.chars()));
        if matches {
            return Ok(Some(identity(&fs::symlink_metadata(entry.path())?)));
        }
    }
    Ok(None)
}

/// A name for an item in `dir` whose collision key matches no other entry
/// there, including hidden and non-Markdown entries, and that the file
/// system does not resolve to an entry other than `own`.
pub(crate) fn choose_name(
    dir: &Path,
    title: &str,
    kind: ItemKind,
    own: Option<(&str, FileIdentity)>,
) -> io::Result<String> {
    let mut taken = std::collections::HashSet::new();
    for entry in fs::read_dir(dir)? {
        let name = entry?.file_name();
        let name = name.to_string_lossy();
        if own.is_some_and(|(own_name, _)| own_name == name) {
            continue;
        }
        taken.insert(names::collision_key(&name));
    }
    let stem = names::stem(title, kind);
    let mut n = 1;
    loop {
        let name = names::file_name(&stem, kind, n);
        n += 1;
        if taken.contains(&names::collision_key(&name)) {
            continue;
        }
        match fs::symlink_metadata(dir.join(&name)) {
            Ok(meta) if own.map(|(_, identity)| identity) != Some(identity(&meta)) => continue,
            Ok(_) => return Ok(name),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(name),
            Err(error) => return Err(error),
        }
    }
}

/// Removes a file or a directory with everything in it.
pub(crate) fn remove_entry(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

/// Removes everything inside a directory, keeping the directory.
pub(crate) fn empty_dir(dir: &Path) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        remove_entry(&entry?.path())?;
    }
    Ok(())
}

/// A new version 4 identifier for an entry Writer did not create, or a
/// unique name in `.writer/tmp/` or `.writer/trash/`.
pub(crate) fn new_id() -> ItemId {
    ItemId::parse(&uuid::Uuid::new_v4().hyphenated().to_string())
        .expect("a hyphenated UUID is lowercase")
}
