import nodemailer from "nodemailer";

type InviteEmailInput = {
  to: string;
  collectionName: string;
  inviterName: string;
  role: "EDITOR" | "MEMBER";
  inviteUrl: string;
  expiresAt: Date;
};

export async function sendCollectionInviteEmail({
  to,
  collectionName,
  inviterName,
  role,
  inviteUrl,
  expiresAt,
}: InviteEmailInput) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    return { sent: false as const, reason: "smtp_not_configured" as const };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });

  const roleLabel = role === "EDITOR" ? "editor" : "viewer";

  await transporter.sendMail({
    from: process.env.SMTP_FROM || `"WorkSphere Collections" <${user}>`,
    to,
    subject: `${inviterName} invited you to \"${collectionName}\"`,
    text: [
      `${inviterName} invited you to join the WorkSphere collection \"${collectionName}\" as a ${roleLabel}.`,
      "",
      `Accept the invitation: ${inviteUrl}`,
      "",
      `This invitation expires on ${expiresAt.toLocaleString()}.`,
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#18181b">
        <h2 style="margin:0 0 12px">You have been invited to a WorkSphere collection</h2>
        <p><strong>${escapeHtml(inviterName)}</strong> invited you to join
        <strong>${escapeHtml(collectionName)}</strong> as a ${roleLabel}.</p>
        <p style="margin:28px 0">
          <a href="${inviteUrl}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">
            Accept invitation
          </a>
        </p>
        <p style="font-size:13px;color:#71717a">
          This invitation expires on ${expiresAt.toLocaleString()}.
        </p>
      </div>
    `,
  });

  return { sent: true as const };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}
