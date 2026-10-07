/** Shared by the server and the browser: plain data only, no imports from server code. */

/** One LINE friend as the "ผู้รับแจ้งเตือน" page gets it. For visitors every personal field is already masked. */
export interface RecipientRow {
  /** React key; the LINE user id for the owner (the switches send it back), a position for visitors */
  key: string;
  /** "U1a2b…9z8y" for the owner, "U••••••••" for visitors */
  idLabel: string;
  displayName: string | null;
  /** null for visitors unless the owner made this picture public */
  pictureUrl: string | null;
  label: string | null;
  active: boolean;
  notify: boolean;
  publicPhoto: boolean;
  /** the name and picture were fetched from LINE (shown to visitors as proof, without the data itself) */
  profileFetched: boolean;
  followedAtLabel: string;
}

export interface FriendRecord {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
  label: string | null;
  active: boolean;
  notify: boolean;
  publicPhoto: boolean;
  followedAtLabel: string;
}

const shortId = (id: string) => `${id.slice(0, 5)}…${id.slice(-4)}`;
export const MASKED_ID = "U••••••••";

/**
 * Owner: everything. Visitor: no user id, no display name, no label (the owner's own notes), and no picture unless
 * the owner switched it on for that friend. Done on the server, so masked data never reaches the browser at all.
 */
export function toRecipientRows(friends: FriendRecord[], owner: boolean): RecipientRow[] {
  return friends.map((f, i) => {
    const profileFetched = f.displayName !== null || f.pictureUrl !== null;
    if (owner) {
      return { ...f, key: f.userId, idLabel: shortId(f.userId), profileFetched };
    }
    return {
      key: `friend-${i + 1}`,
      idLabel: MASKED_ID,
      displayName: null,
      pictureUrl: f.publicPhoto ? f.pictureUrl : null,
      label: null,
      active: f.active,
      notify: f.notify,
      publicPhoto: f.publicPhoto,
      profileFetched,
      followedAtLabel: f.followedAtLabel,
    };
  });
}
