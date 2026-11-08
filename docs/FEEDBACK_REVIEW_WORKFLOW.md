# Beta feedback review (phase 6)

A repeatable way to turn beta feedback into owner decisions. No tool reads the production database except the app itself; ChatGPT and Claude see only a redacted file the owner chose to share, and the owner decides.

| # | Step | Who | How |
|---|---|---|---|
| 1 | Collect | People in the beta | Profile → Send feedback. Stored privately in the `Feedback` table |
| 2 | Triage | Owner (an administrator in `ADMIN_USER_IDS`) | Feedback review page: set status, severity, priority; mark repeats with **Repeats report** (its ID), which sets the status to "Already reported" |
| 3 | Separate | Owner | Category says bug, feature, improvement, usability or general; a bug that is really a request is re-categorised in the note |
| 4 | Export | Owner | **Download a redacted review export** (filters apply). Addresses, links, handles and long numbers are replaced; reporters are pseudonyms valid for that file only; no IDs, notes or task links |
| 5 | Read before sharing | Owner | Redaction can't find names or health details in free text. Remove anything personal by hand. Never commit the file to Git or post it publicly |
| 6 | Product and risk review | ChatGPT, given the file by the owner | Prompt A below |
| 7 | Technical feasibility | Claude, given the same file in a development session | Prompt B below |
| 8 | Compare | Owner, with Claude | A table per item: both assessments, where they disagree, dependencies, proposed priority |
| 9 | Decide | Owner | Approve, decline or defer each item. New features go through `product-strategy-agent` first (`CLAUDE.md`) |
| 10 | Implement | Development session | Only approved items, each with a commit, tests and the report's reference (F-0001…) in the commit message, never the text |
| 11 | Verify and close | Owner | The tests named in the commit, then the feedback's status to Done with the task link (an https link to the issue or commit) |

**Prompt A (product and risk):** "Here is a redacted export of beta feedback for a fitness and nutrition tracking app. For each item (by its ref): is it a defect, a request or an opinion; how many people raise it (count distinct reporters); user impact; any safety, privacy or health-claim risk; your proposed priority (P0 to P3) and why. Don't invent features the users didn't ask for. Flag anything that looks like personal data the redaction missed."

**Prompt B (technical feasibility):** "Using this repository and the same export, for each item: whether the code already does it, what would change (files, data model, migration or not), risk to existing behaviour, test plan, and size (S, M, L). Note conflicts with the product principles in CLAUDE.md, such as AI never inventing nutrition values."

**Retention:** delete exported files once the decisions are recorded. Raw feedback stays in the app's database under the same retention decision as other account data (G2), and is deleted with the account.
