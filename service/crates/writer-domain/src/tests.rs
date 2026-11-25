//! The model's rules, tested without storage or a runtime. Titles and content
//! are synthetic.

use crate::*;

fn id(n: u32) -> ItemId {
    ItemId::parse(&format!("00000000-0000-4000-8000-{n:012x}")).unwrap()
}

fn title(text: &str) -> Title {
    Title::parse(text).unwrap()
}

fn node(n: u32, kind: ItemKind, children: Vec<Node<()>>) -> Node<()> {
    let mut node = Node::new(id(n), kind, title(&format!("Item {n}")), ());
    node.children = children;
    node
}

fn folder(n: u32, children: Vec<Node<()>>) -> Node<()> {
    node(n, ItemKind::Folder, children)
}

fn document(n: u32) -> Node<()> {
    node(n, ItemKind::Document, Vec::new())
}

fn at(parent: Option<u32>, before: Option<u32>) -> Placement {
    Placement {
        parent_id: parent.map(id),
        before_id: before.map(id),
    }
}

fn new_folder(n: u32, placement: Placement) -> NewItem {
    NewItem::folder(id(n), title("Synthetic folder"), placement)
}

fn new_document(n: u32, placement: Placement) -> NewItem {
    NewItem::document(
        id(n),
        title("Synthetic document"),
        placement,
        Markdown::default(),
        Language::default(),
    )
}

/// Folder 1 holds document 2 and folder 3; document 4 is at the top level.
fn sample() -> Tree<()> {
    Tree::from_roots(vec![
        folder(1, vec![document(2), folder(3, vec![])]),
        document(4),
    ])
}

/// A chain of folders 1 to `depth`, each inside the previous one.
fn chain(depth: u32) -> Tree<()> {
    let mut current = folder(depth, vec![]);
    for n in (1..depth).rev() {
        current = folder(n, vec![current]);
    }
    Tree::from_roots(vec![current])
}

fn order(tree: &Tree<()>) -> Vec<(Option<ItemId>, ItemId)> {
    tree.items()
        .into_iter()
        .map(|item| (item.parent_id, item.id))
        .collect()
}

#[test]
fn identifiers_accept_only_lowercase_hyphenated_uuids_of_any_version() {
    for valid in [
        "3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3",
        "00000000-0000-0000-0000-000000000000",
        "0190c2b5-7a2c-7c6e-8b0a-2d4f6e8a0c1b",
    ] {
        assert_eq!(ItemId::parse(valid).unwrap().as_str(), valid);
    }
    for invalid in [
        "",
        "3F2C8A10-6B1E-4D4A-9C55-0E7B2D9A41F3",
        "{3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3}",
        "3f2c8a106b1e4d4a9c550e7b2d9a41f3",
        "urn:uuid:3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3",
        "3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f",
        "3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3a",
        "3f2c8a10_6b1e-4d4a-9c55-0e7b2d9a41f3",
        "3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41g3",
        "../../etc/passwd-0000-0000-0000000000",
    ] {
        assert_eq!(ItemId::parse(invalid), Err(InvalidId), "{invalid:?}");
    }
}

#[test]
fn titles_count_unicode_scalar_values_up_to_200() {
    assert_eq!(Title::parse(""), Err(Violation::Title));
    assert!(Title::parse("a").is_ok());
    assert!(Title::parse("a".repeat(200)).is_ok());
    assert_eq!(Title::parse("a".repeat(201)), Err(Violation::Title));
    // 200 three-byte characters are 600 bytes but 200 characters.
    assert!(Title::parse("灯".repeat(200)).is_ok());
    assert_eq!(Title::parse("灯".repeat(201)), Err(Violation::Title));
    // An emoji outside the Basic Multilingual Plane is one scalar value.
    assert!(Title::parse("🌊".repeat(200)).is_ok());
    // A combining mark is its own scalar value.
    assert_eq!(Title::parse("e\u{301}".repeat(101)), Err(Violation::Title));
}

#[test]
fn titles_reject_surrounding_whitespace_controls_and_separators() {
    for invalid in [
        " Leading",
        "Trailing ",
        "\u{3000}Ideographic space",
        "No-break space\u{a0}",
        "   ",
        "Tab\tinside",
        "Line\nbreak",
        "Next line\u{85}inside",
        "Line\u{2028}separator",
        "Paragraph\u{2029}separator",
        "Escape\u{1b}inside",
        "Delete\u{7f}inside",
    ] {
        assert_eq!(Title::parse(invalid), Err(Violation::Title), "{invalid:?}");
    }
    for valid in [
        "Act 1: Arrival?",
        "con",
        ".plan",
        "Part I.",
        "Inner  spaces",
        "e\u{301}",
        "🌊 Tide",
    ] {
        assert_eq!(Title::parse(valid).unwrap().as_str(), valid);
    }
}

#[test]
fn titles_are_not_normalized() {
    let decomposed = "Cafe\u{301}";
    assert_eq!(Title::parse(decomposed).unwrap().as_str(), decomposed);
}

#[test]
fn content_allows_exactly_one_mebibyte_without_nul() {
    assert!(Markdown::parse("").is_ok());
    assert!(Markdown::parse("a".repeat(MAX_CONTENT_BYTES)).is_ok());
    assert_eq!(
        Markdown::parse("a".repeat(MAX_CONTENT_BYTES + 1)),
        Err(Violation::Content)
    );
    // The limit counts UTF-8 bytes, not characters.
    assert_eq!(
        Markdown::parse("é".repeat(MAX_CONTENT_BYTES / 2) + "a"),
        Err(Violation::Content)
    );
    assert_eq!(Markdown::parse("before\0after"), Err(Violation::Content));
    let exact = "\u{feff}Line one\r\nLine two\r\n";
    assert_eq!(Markdown::parse(exact).unwrap().as_str(), exact);
}

#[test]
fn violations_point_at_their_fields() {
    assert_eq!(Violation::ItemLimit.pointer(), "");
    assert_eq!(Violation::DepthLimit.pointer(), "/parentId");
    assert_eq!(Violation::Title.pointer(), "/title");
    assert_eq!(Violation::Content.pointer(), "/markdown");
    assert_eq!(Violation::Language.pointer(), "/language");
    assert_eq!(
        Violation::Identifier(ItemKind::Folder).pointer(),
        "/folderId"
    );
    assert_eq!(
        Violation::Identifier(ItemKind::Document).pointer(),
        "/documentId"
    );
}

#[test]
fn lists_the_tree_in_pre_order_with_parents() {
    assert_eq!(
        order(&sample()),
        vec![
            (None, id(1)),
            (Some(id(1)), id(2)),
            (Some(id(1)), id(3)),
            (None, id(4)),
        ]
    );
    assert_eq!(sample().len(), 4);
}

#[test]
fn creates_at_the_end_before_a_sibling_and_inside_a_folder() {
    let tree = sample();
    assert_eq!(
        tree.check_create(&new_document(5, at(None, None))),
        Ok(CreateCheck::Insert(Position {
            parent_id: None,
            index: 2
        }))
    );
    assert_eq!(
        tree.check_create(&new_document(5, at(None, Some(4)))),
        Ok(CreateCheck::Insert(Position {
            parent_id: None,
            index: 1
        }))
    );
    assert_eq!(
        tree.check_create(&new_folder(5, at(Some(1), Some(3)))),
        Ok(CreateCheck::Insert(Position {
            parent_id: Some(id(1)),
            index: 1
        }))
    );
    assert_eq!(
        tree.check_create(&new_folder(5, at(Some(3), None))),
        Ok(CreateCheck::Insert(Position {
            parent_id: Some(id(3)),
            index: 0
        }))
    );
}

#[test]
fn a_repeated_create_exists_and_another_kind_conflicts() {
    let tree = sample();
    // The rest of the body is not compared.
    assert_eq!(
        tree.check_create(&new_document(2, at(Some(99), None))),
        Ok(CreateCheck::Exists)
    );
    assert_eq!(
        tree.check_create(&new_folder(1, at(None, None))),
        Ok(CreateCheck::Exists)
    );
    assert_eq!(
        tree.check_create(&new_folder(2, at(None, None))),
        Err(DomainError::Conflict(Conflict::OtherKind))
    );
    assert_eq!(
        tree.check_create(&new_document(3, at(None, None))),
        Err(DomainError::Conflict(Conflict::OtherKind))
    );
}

#[test]
fn creates_conflict_with_a_missing_parent_or_sibling() {
    let tree = sample();
    let missing_parent = Err(DomainError::Conflict(Conflict::MissingParent));
    let missing_sibling = Err(DomainError::Conflict(Conflict::MissingSibling));
    assert_eq!(
        tree.check_create(&new_document(5, at(Some(99), None))),
        missing_parent
    );
    // A document is not a parent.
    assert_eq!(
        tree.check_create(&new_document(5, at(Some(4), None))),
        missing_parent
    );
    assert_eq!(
        tree.check_create(&new_document(5, at(None, Some(99)))),
        missing_sibling
    );
    // The sibling must be a child of the named parent.
    assert_eq!(
        tree.check_create(&new_document(5, at(None, Some(2)))),
        missing_sibling
    );
    assert_eq!(
        tree.check_create(&new_document(5, at(Some(1), Some(4)))),
        missing_sibling
    );
}

#[test]
fn creates_respect_the_depth_limit() {
    let tree = chain(16);
    assert_eq!(
        tree.check_create(&new_document(100, at(Some(15), None))),
        Ok(CreateCheck::Insert(Position {
            parent_id: Some(id(15)),
            index: 1
        }))
    );
    assert_eq!(
        tree.check_create(&new_document(100, at(Some(16), None))),
        Err(DomainError::Invalid(Violation::DepthLimit))
    );
    assert_eq!(
        tree.check_create(&new_folder(100, at(Some(16), None))),
        Err(DomainError::Invalid(Violation::DepthLimit))
    );
}

#[test]
fn creates_respect_the_item_limit() {
    let roots = (1..MAX_ITEMS as u32).map(document).collect();
    let tree = Tree::from_roots(roots);
    assert_eq!(tree.len(), MAX_ITEMS - 1);
    assert!(matches!(
        tree.check_create(&new_document(1_000_000, at(None, None))),
        Ok(CreateCheck::Insert(_))
    ));

    let mut full = tree.clone();
    full.insert(
        &Position {
            parent_id: None,
            index: 0,
        },
        document(MAX_ITEMS as u32),
    )
    .unwrap();
    assert_eq!(
        full.check_create(&new_document(1_000_000, at(None, None))),
        Err(DomainError::Invalid(Violation::ItemLimit))
    );
    // A repeated create still succeeds at the limit.
    assert_eq!(
        full.check_create(&new_document(1, at(None, None))),
        Ok(CreateCheck::Exists)
    );
}

#[test]
fn moves_between_folders_and_reorders_within_a_parent() {
    let mut tree = sample();
    let check = tree
        .check_place(&id(4), ItemKind::Document, &at(Some(1), Some(3)))
        .unwrap();
    assert_eq!(
        check.to,
        Position {
            parent_id: Some(id(1)),
            index: 1
        }
    );
    assert!(tree.relocate(&id(4), &check.to));
    assert_eq!(
        order(&tree),
        vec![
            (None, id(1)),
            (Some(id(1)), id(2)),
            (Some(id(1)), id(4)),
            (Some(id(1)), id(3)),
        ]
    );

    // Moving the first child to the end skips its own slot.
    let check = tree
        .check_place(&id(2), ItemKind::Document, &at(Some(1), None))
        .unwrap();
    assert_eq!(
        check.to,
        Position {
            parent_id: Some(id(1)),
            index: 2
        }
    );
    assert!(tree.relocate(&id(2), &check.to));
    let children: Vec<_> = tree
        .children(Some(&id(1)))
        .unwrap()
        .iter()
        .map(|n| n.id.clone())
        .collect();
    assert_eq!(children, vec![id(4), id(3), id(2)]);

    // Moving before the next sibling keeps the order.
    let check = tree
        .check_place(&id(4), ItemKind::Document, &at(Some(1), Some(3)))
        .unwrap();
    assert!(check.is_unchanged());
}

#[test]
fn a_move_before_itself_in_its_parent_changes_nothing() {
    let tree = sample();
    let check = tree
        .check_place(&id(3), ItemKind::Folder, &at(Some(1), Some(3)))
        .unwrap();
    assert!(check.is_unchanged());
    assert_eq!(
        check.from,
        Position {
            parent_id: Some(id(1)),
            index: 1
        }
    );
    // Before itself in another parent names no child of that parent.
    assert_eq!(
        tree.check_place(&id(3), ItemKind::Folder, &at(None, Some(3))),
        Err(DomainError::Conflict(Conflict::MissingSibling))
    );
}

#[test]
fn moves_conflict_with_missing_targets_and_cycles() {
    let tree = sample();
    assert_eq!(
        tree.check_place(&id(4), ItemKind::Document, &at(Some(99), None)),
        Err(DomainError::Conflict(Conflict::MissingParent))
    );
    assert_eq!(
        tree.check_place(&id(4), ItemKind::Document, &at(Some(2), None)),
        Err(DomainError::Conflict(Conflict::MissingParent))
    );
    assert_eq!(
        tree.check_place(&id(4), ItemKind::Document, &at(Some(1), Some(99))),
        Err(DomainError::Conflict(Conflict::MissingSibling))
    );
    assert_eq!(
        tree.check_place(&id(1), ItemKind::Folder, &at(Some(1), None)),
        Err(DomainError::Conflict(Conflict::Cycle))
    );
    assert_eq!(
        tree.check_place(&id(1), ItemKind::Folder, &at(Some(3), None)),
        Err(DomainError::Conflict(Conflict::Cycle))
    );
}

#[test]
fn moves_of_a_missing_item_or_the_other_kind_are_not_found() {
    let tree = sample();
    assert_eq!(
        tree.check_place(&id(99), ItemKind::Document, &at(None, None)),
        Err(DomainError::NotFound)
    );
    assert_eq!(
        tree.check_place(&id(1), ItemKind::Document, &at(None, None)),
        Err(DomainError::NotFound)
    );
}

#[test]
fn moves_respect_the_depth_of_the_whole_subtree() {
    // Folders 1 to 14 in a chain, and folder 100 holding folder 101 holding
    // document 102 at the top level.
    let mut tree = chain(14);
    tree.insert(
        &Position {
            parent_id: None,
            index: 1,
        },
        folder(100, vec![folder(101, vec![document(102)])]),
    )
    .unwrap();
    // Into folder 13: depths 14, 15, and 16.
    assert!(
        tree.check_place(&id(100), ItemKind::Folder, &at(Some(13), None))
            .is_ok()
    );
    // Into folder 14: the document would be at depth 17.
    assert_eq!(
        tree.check_place(&id(100), ItemKind::Folder, &at(Some(14), None)),
        Err(DomainError::Invalid(Violation::DepthLimit))
    );
    // A leaf fits deeper.
    assert!(
        tree.check_place(&id(102), ItemKind::Document, &at(Some(14), None))
            .is_ok()
    );
}

#[test]
fn removes_a_subtree_and_reinserts_it() {
    let mut tree = sample();
    let (position, removed) = tree.remove(&id(1)).unwrap();
    assert_eq!(
        position,
        Position {
            parent_id: None,
            index: 0
        }
    );
    assert_eq!(removed.count(), 3);
    assert_eq!(order(&tree), vec![(None, id(4))]);
    assert!(tree.get(&id(2)).is_none());

    tree.insert(&position, removed).unwrap();
    assert_eq!(tree, sample());
    assert!(tree.remove(&id(99)).is_none());
}

#[test]
fn inserting_into_a_missing_or_document_parent_returns_the_node() {
    let mut tree = sample();
    let orphan = document(5);
    let into_document = Position {
        parent_id: Some(id(4)),
        index: 0,
    };
    assert_eq!(tree.insert(&into_document, orphan.clone()), Err(orphan));
    assert_eq!(tree, sample());
}

#[test]
fn lineage_runs_from_the_top_level_to_the_item() {
    let tree = sample();
    let lineage: Vec<_> = tree
        .lineage(&id(3))
        .unwrap()
        .iter()
        .map(|n| n.id.clone())
        .collect();
    assert_eq!(lineage, vec![id(1), id(3)]);
    assert!(tree.lineage(&id(99)).is_none());
    assert_eq!(tree.find(&id(3), ItemKind::Folder).unwrap().height(), 1);
    assert_eq!(tree.find(&id(1), ItemKind::Folder).unwrap().height(), 2);
}

#[test]
fn languages_accept_only_supported_bcp_47_tags_and_default_to_english() {
    assert_eq!(Language::default(), Language::En);
    assert_eq!(Language::parse("en"), Ok(Language::En));
    assert_eq!(Language::parse("es"), Ok(Language::Es));
    assert_eq!(Language::En.as_str(), "en");
    assert_eq!(Language::Es.as_str(), "es");
    for invalid in ["", "EN", "Es", "en-US", "es-MX", "fr", " en", "es ", "spa"] {
        assert_eq!(
            Language::parse(invalid),
            Err(Violation::Language),
            "{invalid:?}"
        );
    }
    assert_eq!(Violation::Language.pointer(), "/language");
}

#[test]
fn tree_items_report_language_for_documents_and_none_for_folders() {
    let mut tree = sample();
    tree.get_mut(&id(2)).unwrap().language = Some(Language::Es);
    let languages: Vec<_> = tree
        .items()
        .into_iter()
        .map(|item| (item.id, item.language))
        .collect();
    assert_eq!(
        languages,
        vec![
            (id(1), None),
            (id(2), Some(Language::Es)),
            (id(3), None),
            (id(4), Some(Language::En)),
        ]
    );
}
