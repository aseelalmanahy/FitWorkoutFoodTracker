import { requireProfile } from "@/lib/server/profile";
import { profileToValues } from "@/lib/server/serialize";
import { LegalLinks } from "@/components/legal-links";
import { ProfileForm } from "@/components/profile/profile-form";
import { ButtonLink, PageHeader } from "@/components/ui";
import { isAdmin } from "@/lib/server/admins";
import { InstallHelp } from "@/components/pwa/install-help";
import { AccountActions } from "./account-actions";
import { Page } from "@/components/page";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { user, profile } = await requireProfile();
  return (
    <Page width="medium">
      <PageHeader title="Profile" subtitle={user.email} />
      <ProfileForm initial={profileToValues(profile)} submitLabel="Save changes" />
      <div className="my-6 flex flex-wrap gap-2">
        <ButtonLink href="/feedback?from=/profile" variant="secondary" data-testid="feedback-link">Send feedback</ButtonLink>
        {isAdmin(user.id) && <ButtonLink href="/admin/feedback" variant="ghost" data-testid="admin-feedback-link">Feedback review</ButtonLink>}
      </div>
      <InstallHelp />
      <AccountActions />
      <LegalLinks />
    </Page>
  );
}
