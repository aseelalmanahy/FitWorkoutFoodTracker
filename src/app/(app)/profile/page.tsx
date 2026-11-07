import { requireProfile } from "@/lib/server/profile";
import { profileToValues } from "@/lib/server/serialize";
import { LegalLinks } from "@/components/legal-links";
import { ProfileForm } from "@/components/profile/profile-form";
import { PageHeader } from "@/components/ui";
import { AccountActions } from "./account-actions";
import { Page } from "@/components/page";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { user, profile } = await requireProfile();
  return (
    <Page width="medium">
      <PageHeader title="Profile" subtitle={user.email} />
      <ProfileForm initial={profileToValues(profile)} submitLabel="Save changes" />
      <AccountActions />
      <LegalLinks />
    </Page>
  );
}
