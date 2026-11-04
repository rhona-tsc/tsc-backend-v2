# Project chat unread indicator

The workspace's **Project chat** summary shows a red unread-message count, capped visually at `99+`, while retaining the full count in its accessible label. It updates every five seconds in a visible tab, including while the chat panel is collapsed. It counts messages from other people, including attachment-only and voice messages; it does not count the signed-in person's own messages.

Read positions are private per project/account in `originalchatread`, with a unique compound project/musician index. They persist across refreshes, tabs and devices. A person without an existing read position initially sees earlier messages from other people as unread; no historical read activity is fabricated.

New protected endpoints:

- `GET /projects/:id/messages/unread` returns only the current account's unread count. Reading this endpoint or loading the workspace/messages never marks messages read.
- `POST /projects/:id/messages/read` accepts `messageId`, identifying the latest message actually rendered and viewed. The server obtains that message's timestamp from the same project, ignores supplied actor/cursor/timestamp fields and updates only the signed-in account's position.

The cursor uses the same `(createdAt, _id)` order as chat loading, including messages created in the same millisecond. A fixed-width UTC timestamp and ObjectId form a single comparable key. The server advances it with [MongoDB's `$max` update operator](https://www.mongodb.com/docs/manual/reference/operator/update/max/) and simple binary collation; a slow/older tab cannot rewind a newer read position. A duplicate-key race on the first upsert retries safely. Messages arriving after the acknowledged message remain unread.

The UI acknowledges only when the chat is expanded, the browser tab is visible/focused, and the end of the rendered messages is visible inside both the scrolling chat list and the browser viewport. Opening a panel off-screen, reading scrollback or using the owner's read-only participant preview does not mark unseen messages read. Counts clear only after the server saves the read position. Failed saves retain the known count and retry on refresh; older in-flight count responses cannot restore a cleared badge.

Existing project participation/referral checks protect both endpoints. An account whose role participation has ended loses these endpoints as well as chat and file access. Unread status never exposes another person's read position or introduces group read receipts. Existing chat email notifications remain unchanged, and the collapsed indicator does not fetch message bodies, media or Cloudinary files.

Deploy admin and backend together, creating the read-state collection's project/musician unique index before live use. No production read positions or emails were changed during development. Tests use model stubs, local HTTP routes and browser fixtures; database index creation and persistence should be checked after deployment.

Validation covers own/other accounts, exact message boundaries, equal-time IDs, messages arriving during a save, stale-tab updates, invalid/foreign message IDs, first-upsert races, authenticated route access and revoked membership. Browser checks exercise the actual workspace components for closed/open badges, persistence, background/off-screen visibility, scrollback, stale responses, retries, read-only preview and mobile layout.
