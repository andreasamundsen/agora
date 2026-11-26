# Using Agora

Agora is a workspace for building and reading an argument map. This guide covers the library, the two graph views, editing, the chamber, Stage, and themes.

[Back to README](../README.md) · [Judging](judging.md) · [Providers & models](providers.md)


## Convening a debate

Choose **New debate**, state a position, and map it. While the map is being generated, the **×** closes the dialog and cancels the request; tokens the provider has already generated may still be billed. A cancelled map is not saved.

## The library

Every debate is stored as plain JSON under `data/debates/`. Click a card to open it; use `×` to remove it.

## The map

The map is a pan/zoom argument graph. The thesis sits in the centre.

- **Case view** groups direct pro arguments on the left and direct con arguments on the right.
- **Thread view** keeps those direct cases in place but attaches each response to the argument it answers, extending the reply chain outward on that argument's side. Replies share vertical space, so Thread view stays close to Case view's height. A con reply can sit on the pro side where its target lives; the card's For/Against badge and colour carry the stance.
- Dense maps open as a complete overview; small maps open at a readable scale. Drag to pan, scroll to zoom, and use **Fit** to recover the whole shape.
- The static map refits when the window changes size. After a manual pan or zoom it preserves your view until you press **Fit**.
- Select a card for the inspector: full text, premises, conclusion, and relations.
- **Edit map** opens a separate draft editor. Read mode has no per-card action buttons.

## Editing the map

`Edit map` changes the map from a reading surface into a draft. Nothing is written until **Done**; **Cancel** restores the saved map. The motion is edit-only: it is the root claim, so it cannot be added or removed.

- Every argument exposes kind (argument or statement), title, text, premises, conclusion, and tags. The motion exposes the same content fields.
- **Side** and **speaker** are derived from the graph, not separate fields. Change the relation that places an argument to change its side; the editor shows the result before you save.
- **Add response** creates an argument and its relation in one step. **Link existing** attaches the selected argument to another card or the motion. Relation types can be changed between support, attack, and undercut, and relations can be removed.
- **Remove argument** removes the card and its incident relations. The editor refuses to remove the motion, to strand a response whose only path is through a removed argument, or to remove the only relation that keeps a card connected.
- Links that would create a loop are refused.
- `Undo` / `Redo` stay inside the draft; `Ctrl+Z` / `Ctrl+Shift+Z` and `Delete` work when focus is not in a form field. `Esc` cancels an unfocused draft.

Edits are saved through the same atomic debate-store path as the rest of the app and preserve the debate's chat, origin, and metadata.

## The chamber

The chamber is a conversation with the cartographer about the map, or about anything else. Ask what the crux is, where the weakest premise lies, which branch is doing the most work, what would change the conclusion, or ask a general question. Answers are concise prose, usually one substantial paragraph, and distinguish map claims from general knowledge. The chamber is read-only: it does not add, remove, move, or relink arguments. Without a model it gives a structural summary and says so.

## The stage

`Stage Debate` turns the map into a performance. The order is a seeded branch walk through the graph: arguments directly tied to the motion alternate sides, and each branch is drained before the next root begins. The motion opens, you state your position, advocates and challengers take turns, rebuttals surface where they connect, and the moderator closes. Each run samples a new sequence; `Cut a new sequence` resamples without leaving the stage. The camera follows the argument being made.

Stage controls: `Space` play/pause, `←`/`→` previous/next turn, a speed selector, the optional **Read turns aloud** browser voice, and `Esc` to close. With voice on, the stage waits for the browser to finish each utterance before advancing; `Next` still moves on immediately. The stage records nothing; it is a way of reading the map aloud.

## Appearance

Settings → Appearance switches between **System**, **Light**, **Dark**, and **Aurora**. System follows the Windows appearance setting. Light is **Editorial paper** — warm parchment with a walnut motion card, olive support, rust attack cards, and walnut-brown actions. Dark is **Night Reading Room**, and Aurora is a twilight variant of the dark palette: deep indigo-black, rose–lilac–periwinkle chrome, ice-blue support and rose attack cards. The choice is remembered on this machine and applied before the interface paints, so the dark reading room does not flash paper-white at launch. The desktop window background follows the saved theme on the next launch.
