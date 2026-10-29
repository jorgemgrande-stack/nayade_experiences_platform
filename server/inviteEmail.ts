import { sendEmail } from "./mailer";
import { logDirectEmail } from "./emailManager";
import { inviteContent } from "./mail/accountTemplates";
import { brandName } from "./tenantBrand";

export async function sendInviteEmail(params: {
  name: string;
  email: string;
  setPasswordUrl: string;
  role: string;
}) {
  const m = inviteContent({ name: params.name || null, company: brandName() || "tu empresa", role: params.role, url: params.setPasswordUrl, hours: 72 });
  const inviteSubject = m.subject;
  const sent = await sendEmail({ to: params.email, subject: inviteSubject, category: "user_invite", html: m.html, text: m.text });
  logDirectEmail({ templateKey: "invite", triggerEvent: "user_invited", recipientEmail: params.email, subject: inviteSubject, sent }).catch(() => {});
  if (sent) {
    console.log(`[InviteEmail] Sent to ${params.email}`);
  } else {
    console.error(`[InviteEmail] Error sending to ${params.email}`);
  }
  return sent;
}
