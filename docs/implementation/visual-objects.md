# Visual objects

Recurring object profiles are keyed by a bounded normalized key and retain a
human-readable name. The payload stores description, shape, materials, colors,
distinctive features, condition, keywords, negative traits, style notes, and
optional reference asset IDs.

## Resolution order

For each Scene object label, the resolver applies:

1. an explicit `scene_object_resolutions` mapping;
2. an exact normalized object key;
3. a unique project-local name match.

Case and punctuation variants can therefore reuse one canonical profile. More
than one name match is ambiguous and remains unresolved with a warning. Missing
profiles remain visible in the package rather than being guessed.

The Visual Bible exposes an explicit mapping control for each recurring object.
Selecting an approved profile persists a Scene-revision mapping and stales only
the current package for that Scene. Clearing the selection persists an
unresolved mapping.

Generated object profiles are draft candidates. Approval is explicit; approved
profile edits create new revisions and invalidate only dependent packages.
Object profiles are identity records, not generated image assets.
