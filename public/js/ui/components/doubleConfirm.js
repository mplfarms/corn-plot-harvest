// src/ui/components/doubleConfirm.js
//
// A stronger confirmation than a single Cancel/Confirm dialog, used for
// this app's most destructive, unrecoverable actions: deleting an
// account (admin-triggered or a user deleting their own) and merging one
// account's plots into another. A first dialog explains the
// consequences in plain language; only after confirming that does a
// second step require typing an exact word before anything actually
// happens. A single accidental tap (or a reflexive "yes" on the first
// dialog) can never trigger these on its own.
//
// Deliberately NOT used for routine, easily-reversible-in-spirit actions
// like deleting a single saved plot from your own library, or
// promoting/demoting admin status — those keep their existing single
// showConfirm() dialog. This is reserved for actions that move or delete
// an entire account's worth of data at once.

import { showConfirm, showPrompt } from "./modal.js";

/**
 * @param {{title: string, message: string, confirmLabel?: string, typeWord?: string}} opts
 * @returns {Promise<boolean>}
 */
export async function doubleConfirm(opts) {
  const typeWord = opts.typeWord || "DELETE";

  const firstOk = await showConfirm({
    title: opts.title,
    message: opts.message,
    confirmLabel: opts.confirmLabel || "Continue",
    destructive: true,
  });
  if (!firstOk) return false;

  const typed = await showPrompt({
    title: "Are You Sure?",
    message: `This can't be undone. Type ${typeWord} to confirm.`,
    placeholder: typeWord,
    confirmLabel: opts.confirmLabel || "Confirm",
  });
  if (typed === null) return false;
  return typed.trim().toUpperCase() === typeWord.toUpperCase();
}
