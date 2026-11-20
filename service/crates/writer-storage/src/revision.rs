use sha2::{Digest, Sha256};
use writer_domain::Revision;

/// The revision of content: the lowercase hexadecimal form of the first 16
/// bytes of the SHA-256 digest of its UTF-8 bytes, identical in every
/// backend.
pub fn revision_of(bytes: &[u8]) -> Revision {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(32);
    for byte in &digest[..16] {
        hex.push(char::from_digit(u32::from(byte >> 4), 16).unwrap_or('0'));
        hex.push(char::from_digit(u32::from(byte & 0xf), 16).unwrap_or('0'));
    }
    Revision::new(hex)
}

#[cfg(test)]
mod tests {
    use super::revision_of;

    #[test]
    fn matches_the_known_values() {
        assert_eq!(
            revision_of(b"").as_str(),
            "e3b0c44298fc1c149afbf4c8996fb924"
        );
        assert_eq!(
            revision_of(b"The keeper climbed the stairs twice before lighting the lamp.\n")
                .as_str(),
            "50a52a64cb33d03e10dc09540168aec7"
        );
    }
}
