import{i as e,n as t,r as n,s as r,t as i}from"./index-CEuAl5x-.js";import{n as a,t as o}from"./lib-84JX8Zg1.js";var s=r(e(),1),c=t();function l(){let[e,t]=(0,s.useState)(null);return(0,s.useEffect)(()=>{let e=!0;return n.getAbout().then(n=>{e&&t(n)},()=>void 0),()=>{e=!1}},[]),e?(0,c.jsxs)(`p`,{className:`help-version`,title:e.revision??void 0,children:[`Ontotator `,e.version,e.revision&&(0,c.jsxs)(c.Fragment,{children:[` · commit `,e.revision.slice(0,7)]})]}):null}var u=`# Ontotator user handbook

This handbook explains how to work with Ontotator in the browser. It is for everyone who uses the app: annotators, translation reviewers, consolidators, leads and system administrators. It describes the version of Ontotator that you open it from. If you run the server, read the [server operations guide (for server operators)](../operations.md) instead.

## Start here

| You are… | Read first | Then |
| --- | --- | --- |
| New to Ontotator, any role | [Getting started](getting-started.md) | the chapter for your role |
| Annotator or translation reviewer | [Your first task, start to finish](first-task.md) | [Annotator reference](annotator.md) |
| Consolidator | [Typical consolidation, start to finish](consolidator.md#typical-consolidation-start-to-finish) | [Consolidator chapter](consolidator.md) |
| Project lead | [Lead overview and typical project](lead.md) | [Settings](lead-settings.md), [Documents](lead-documents.md), [Results and export](lead-results.md), [Change course](lead-change-course.md) |
| System administrator | [Administration](admin.md) | |

Stuck? See the [frequently asked questions](faq.md).

## What Ontotator is

Ontotator is a web app for marking findings in clinical texts and linking each one to a term of an ontology, for example the Human Phenotype Ontology (HPO). Several people annotate the same text, each on their own. The project lead then chooses one final result per text, either one submission or a merged consolidation. The final results are exported for research.

### Why people work independently

Each annotator works blind: you never see other people's work on the same text, only your own and, in some tasks, a tool's proposals. This keeps the results independent, so that the project can measure how well annotators agree and find texts or rules that are unclear. Only leads and consolidators see everyone's work.

### What happens to your work

- While you work, everything is saved automatically as a draft. Nobody else sees your draft.
- When you submit, your work becomes a fixed **submission**. The lead sees it; other annotators do not.
- The lead accepts one result per text as the **final result**, or asks a consolidator to merge differing submissions. Only final results are exported. Exports show your pseudonym, not your name.

## Roles

You can have more than one role. Roles other than system administrator apply to one project. The header shows your roles under your name.

| Role in the UI | What you do | Chapter |
| --- | --- | --- |
| **Annotator** | Mark findings in the texts assigned to you, check tool proposals, submit your work. Annotators also do translation reviews. | [Annotator reference](annotator.md) |
| **Translation reviewer** | Not a separate role you can be given: any annotator can get a translation review task. The header shows this name while you work on one. | [Review a translation](annotator.md#review-a-translation) |
| **Consolidator** | Merge the differing submissions on one text into one result. | [Consolidator chapter](consolidator.md) |
| **Lead** | Set up the project, upload texts, plan and assign work, publish guidelines, accept results, export. | [Lead overview](lead.md) |
| **System administrator** | Create user accounts, upload ontology releases, create projects, handle technical reports. | [Administration](admin.md) |

## How work flows

(translation review →) annotate → accept, or consolidate and accept → export

![How work flows: the lead uploads clinical texts, some of them translated; a reviewer checks each translation against its source; several annotators each annotate the same text on their own; if their submissions agree, the lead accepts one as the result; if they differ, a consolidator merges them into one result; the lead exports one final result per text](images/workflow.png)

1. **Translation review** (only for translated texts, if the project plans it): an annotator checks the translation against the source and accepts, corrects, queries or rejects it. The lead decides what happens with queried or rejected translations.
2. **Annotate**: the lead assigns a text to one or more annotators. Each annotator marks findings, either from scratch or from tool proposals. In a task from proposals, the annotator confirms, rejects or replaces each proposal. Then they submit the text.
3. **Accept**: on the **Documents** page, the lead sees all submissions of a text. If they agree, or if one is clearly right, the lead clicks **Accept result** or **Use as final**.
4. **Consolidate**: if the submissions differ, the lead clicks **Consolidate…** and picks a consolidator. The consolidator decides each difference and submits one merged result. The lead then accepts it.
5. **Export**: the lead exports the final results of the project.

A lead can also reopen a submission, and an annotator can continue from their own submission in a new work round. A problem report pauses a task until it is decided.

## Glossary

Words you meet in the app, in alphabetical order. The handbook uses one word per concept; where the app uses a second word, it is named here.

| Word | Meaning |
| --- | --- |
| Agreement | On the lead's text card: how many findings of the submissions on a text match. Findings that match in term and passage but differ in a value "differ in context only". |
| Annotation scheme | The set of value fields and modifiers a project uses, for example **HPO phenotype (fixed qualifiers, modifiers)**. |
| Branch | A part of an ontology: one term and everything below it. A project can limit search to some branches. |
| Carried finding | A finding taken over from an earlier round or text version into your current task. You check each one before you submit: it is marked **Check needed** until you do. To *carry* work means to take it over this way. |
| Case | One clinical document in all its languages, identified by its **case ID**. A case has one text per language. |
| Consolidation | A task that merges differing submissions on one text into one result. |
| Consolidator | The person who does a consolidation. Needs the **Consolidator** role in the project. |
| Default (prefilled value) | A value a new finding starts with, tagged **Default**. It counts as not confirmed until you confirm or change it. |
| Document | The app's word for a text in the page name **Documents**. Same as *text* in this handbook. |
| Final result | The one submission or consolidation per text that the lead accepts. Only final results are exported. |
| Finalization | The third part of the lead's text card, where the lead accepts the final result or starts a consolidation. |
| Finding | One ontology term marked in a text, with its values, modifiers and zero or more mentions. |
| Group | In a consolidation: the findings from different submissions on overlapping passages, decided together. |
| Guidelines | The project's annotation rules. Leads publish numbered versions (v1, v2, …); you read the version in force. A lead can add the version the document gives itself; it is then shown first, for example *3.1 (v2)*. |
| Layer | Part of the annotation setup with its own ontology. Each required layer must be checked before you submit. A **Reference** layer is read-only; a **Locked** layer cannot be edited. |
| Mention | A marked passage of text that supports a finding. A finding can have several mentions. |
| Modifier | An HPO term such as a severity or an onset, attached to a finding. |
| Ontology release | A loaded version of an ontology, for example one HPO release. Each project uses one release. |
| Ontospan bundle | A file format for uploading texts together with their translations and tool proposals. See [Prepare files for upload](lead-documents.md#prepare-files-for-upload). |
| Paused | A task that waits for a decision on a problem report. You can read it but not change or submit it. |
| Pin | A project *pins* the ontology release it uses. **Pinned by** on the **Ontologies** page lists those projects. |
| Problem report | A report that a text has a problem. It pauses your task until the lead decides. |
| Project | A unit of work with its own texts, people, ontology release, guidelines and settings. |
| Proposal layer | The tool proposals uploaded with a text. |
| Pseudonym | Your stable ID, for example \`ann-0004\`. Exports show it instead of your name. |
| Reopened | A submission the lead opened again for changes. Your task shows **Reopened** with the lead's reason. |
| Round | One pass of work on a task. A task can have several rounds, for example after you continue from your submission or after the text changed. |
| Spanless finding | A finding that points to no text passage. The project decides whether this is allowed and whether it needs a reason. |
| Submission | The fixed result of a task or round. To change it, a new round starts. |
| Task | Your piece of work on one text: Annotation, Translation review or Consolidation. |
| Task profile | The JSON file that defines a project's layers, finding types and value fields. |
| Text | One language version of a case, for example *CASE-1 en*. Tasks are always on one text. |
| Text card | The panel that opens on the lead's **Documents** page for one text, with the parts **Translation**, **Annotation** and **Finalization**. |
| Text version | One revision of a text (v1, v2, …). A correction creates a new version; the old one stays. |
| Tool proposal | A finding suggested by an external tool and uploaded with the text. You confirm, reject or replace it. |
| Translation review | A task in which you check a translated text and accept it, correct it, query it or reject it. |
| Unresolved | A decision on a tool proposal: you cannot decide it and leave a note for the lead. Not the same as clinical uncertainty (the value **Uncertain**). |
| Value field | One line under **Values** in a finding, with a fixed list of values, for example the assertion (**Present**, **Absent**, **Uncertain**). Scheme names call them *qualifiers*. |
| Work plan | Per text: whether it gets a translation review, and whether and how it is annotated. |

## Chapters

1. [Getting started](getting-started.md): log in, set your password, find your tasks, edit your profile.
2. [Your first task, start to finish](first-task.md): one annotation task from login to submission.
3. [Annotator reference](annotator.md): the editor, findings, values, tool proposals, carried findings, submitting, problem reports, translation review.
4. [Consolidator chapter](consolidator.md): how to decide, the groups, finishing a consolidation.
5. [Lead overview](lead.md): the typical project, with [Settings](lead-settings.md), [Documents](lead-documents.md), [Results and export](lead-results.md) and [Change course in a running project](lead-change-course.md): another translation, annotating again, fewer texts.
6. [Administration](admin.md): user accounts, ontology releases, projects.
7. [FAQ](faq.md): typical problems and what to do.

## How the handbook writes things

- **Bold** text is a label exactly as the app shows it, for example **My tasks**. <!-- handbook: not-a-label -->
- *Italic* text is an example of a label or message that changes, for example *Publish as v2* or *CASE-1 en*.
- Keys are written like \`Ctrl+Z\` (macOS: \`Cmd+Z\`). A letter key such as \`j\` means the plain key; \`Shift+K\` means with Shift.
`,d=`# Administration

This chapter is for system administrators. You manage user accounts, ontology releases and projects in the app, and read the technical reports users send. Back to the [handbook overview](README.md).

Server set-up, the command line, backups, upgrades and deployment are in the [server operations guide (for server operators)](../operations.md). A lost administrator password is also handled there: see [Lost admin password](../operations.md#lost-admin-password).

Ontotator sends no e-mail. New users and users who forgot their password get a one-time code from you, by hand.

## Set up a new project for a lead

The usual first day, in order:

1. [Upload the ontology release](#upload-ontology-releases-and-translation-files) the project needs.
2. [Create the project](#create-a-project).
3. [Create a user account](#create-a-user-account) for the lead, with the **Lead** role in the new project.
4. [Hand over the setup code](#hand-over-a-setup-or-reset-code) to the lead.

The lead then sets up the rest; see the [lead overview](lead.md).

Try it with the demo project: the [demo project guide](../../examples/demo-project/README.md) has an HPO release link, suggested users and all files to upload for a fully synthetic project.

## Reach the administration pages

What for: find the pages only system administrators see.

1. Log in. Your role line in the header reads **System administrator**.
2. Click the gear at the top right. It opens **Administration** on the **Users** page.
3. In the sidebar of this area, click **Users**, **Ontologies**, **Technical reports** or **Server settings**.
4. Click **Back to Projects** to return to your work.

Other users do not see the gear. If they open such a page by its address, they get a short explanation instead. **New project** is a button on the **Projects** page; see [Create a project](#create-a-project).

## Find and review user accounts

What for: check who has an account, whether they finished setup and when they last logged in.

1. Click the gear at the top right and open **Users**.
2. Type a username or display name into **Filter users**. With more than 100 accounts, the table shows the first 100; **Show all** shows the rest.
3. Read the table. **Setup** shows **Pending** until the person has set a password. **Last login** shows **Never** if they have not logged in yet. **Active** reads **Yes**, **No** or **Anonymised**. **Projects** shows how many projects the person belongs to; click it to see the projects and the person's roles in each.
4. Click a row to highlight it. Click it again to clear the highlight.
5. Click **Refresh users** to reload the list.

## Create a user account

What for: give a new person access to Ontotator.

1. On **Users**, click **New user…**.
2. Fill **Username** and **Display name**. **E-mail**, **Qualification** and **Languages** are optional.
   - **Qualification**, for example *physician*, is needed before the person can submit a translation review.
   - **Languages** are the languages the person reads. Leads see them when they assign work, and **Distribute evenly…** proposes only people who read a text's languages. Leave them empty if you do not know them: no languages count as unknown, not as "reads nothing", and such a person is proposed only where nobody who lists the language is left.
3. Tick **System administrator** only if the person should manage the whole server.
4. Optional: under **Add to projects (optional)**, tick a role per project: **Lead**, **Annotator** or **Consolidator**. With many projects, type into **Find project** to narrow the list. Projects with the same name also show their project key, for example *Study One (study-one-2026)*.
5. Click **Create user**.
6. The setup-code dialog opens. [Hand over the code](#hand-over-a-setup-or-reset-code).

The username uses 3–64 lower-case letters, digits, dots, hyphens or underscores. If it is taken or invalid, the message appears at the field.

## Hand over a setup or reset code

What for: let a person set their own password. Codes are shown only once.

1. A dialog opens with the title **Setup code** or **Reset code** and the username. It shows the code and when it expires.
2. Click **Copy hand-over text**. This copies short instructions with the login address, the username and the code. Open **Hand-over text** to read it first. **Copy** copies only the code.
3. Give the text to the person in person or by a secure channel.
4. Tick **I have handed over or stored the code**.
5. Click **Close**.

![Setup code dialog with the hand-over text open and the confirmation box](images/admin-setup-code.png)

You cannot close the dialog or leave the page until the box is ticked. The dialog and the hand-over text say when the code expires: a setup code lasts 7 days by default (whoever runs the server can change this, see \`ONTOTATOR_SETUP_CODE_HOURS\` in docs/operations.md), a reset code always 2 hours. The person then uses **I have a setup or reset code** on the login page, see [Getting started](getting-started.md#set-your-password-with-a-setup-or-reset-code).

## Issue a new setup or reset code

What for: a code expired, got lost, or someone forgot their password.

1. On **Users**, click **More…** in the person's row.
2. Choose **New setup code** (setup still pending) or **Reset code** (password already set).
3. Confirm with **New setup code** or **Reset code**. The dialog says what follows:
   - Any earlier unused code stops working.
   - A reset code logs the person out on all devices at once, not only when the code is used. Someone in the middle of a task sees *Your session has ended. Please log in again.* at their next click, so issue a reset code only when the person asked for one or the account may be in the wrong hands.
   - All API tokens of the person are revoked, with a reset code and with a new setup code alike.
   - With a reset code, the current password keeps working until the new code is used: the person can log in again right away.
4. [Hand over the code](#hand-over-a-setup-or-reset-code).

Deactivated accounts get no new code. Activate the account first.

## Edit a user's profile and administrator role

What for: correct a name, e-mail, qualification or languages, or grant or remove the administrator role.

1. On **Users**, click **Edit** in the row.
2. Change **Display name**, **E-mail**, **Qualification**, **Languages** or **System administrator**.
3. Click **Save changes**.
4. If you changed the administrator role, confirm with **Save changes** again. The person is logged out everywhere. Removing the role revokes their system tokens and their project tokens for projects they do not lead; their personal tokens keep working with the roles they still have. Granting the role revokes no token.

You cannot remove your own administrator role. The last active system administrator cannot lose the role either; add another one first.

## Deactivate or activate an account

What for: stop someone from logging in, without deleting their work.

1. On **Users**, click **More…** in the row.
2. Choose **Deactivate…**.
3. Confirm with **Deactivate**. The person is logged out everywhere and their API tokens are revoked.
4. To undo, open **More…** again and choose **Activate**.

You cannot deactivate your own account. In project member lists the person shows as **Inactive**.

## See a user's history

What for: check what was changed on an account and by whom.

1. On **Users**, click **More…** in the row and choose **History**. For anonymised accounts, click the **History** button in the row.
2. Read the table: **When**, **By**, **What**, **Whom**, **Project**, **Details**. **What** names the change in plain words, for example *Project settings changed*, *Final result withdrawn*, *Final export created* or *Phenopackets created*. Research exports are listed too, for example *Edit log exported* or *Working time exported*. A text given its own number of annotators reads *Annotators per text changed for one text*, with the text, the old and new value and the project value under **Details**. *Languages changed* says which languages were added and removed (*Added: fr. Removed: es.*). *Project settings changed* names each setting as the settings page does, with the old and the new value (*Hide annotator names during consolidation: off → on*); the description, the prefilled values and the values annotators can choose are named without values. Entries from before these values were recorded show the names only. On a phone, scroll the table sideways to read **Details**.
3. Changes made with an API token name it under **Details** (*Via API token*); the single requests a token made are left out here. The dialog shows the newest 200 entries. For the whole trail, use the command \`ontotator admin audit\`, see [Server operations](../operations.md#users-ontologies-and-projects). An editorial correction of a translation is recorded as *Typo fix in a translation*; its details carry the reason and the changed passages. A submitted annotation that such a fix moved to the new version by itself is recorded as *Annotation moved to a typo fix automatically*, naming the submission it came from; the system made that change, so it names no person who did it. A lead's decision on a queried translation review is recorded as *Query on a translation decided*, with the kind of decision and the answer to the reviewer. A lead's addition to the reason of a correction request is recorded as *Added to the reason of a translation correction*, with the text added.

## Anonymise a deactivated account

What for: erase a person's personal data for good, while keeping their work.

Warning: anonymising cannot be undone.

Before you start: [deactivate the account](#deactivate-or-activate-an-account).

1. On **Users**, click **More…** in the row and choose **Anonymise…**.
2. Read what is erased. The pseudonym and all work stay, so results and exports remain complete.
3. Type the username into the confirmation field.
4. Click **Anonymise permanently**.

## Handle technical reports

What for: read what users report about error messages, pages that do not load, crashes and the app in general, and keep track of what is handled.

1. Click the gear at the top right and open **Technical reports**. The number after it, and on the gear, counts the open reports.
2. **Show** lists the **Open** reports. Choose **Done** or **All** to see the others.
3. Read a report. It shows its reference (for example *TR-12*), the user's text, who sent it and when. Below are the details Ontotator added: app version, the task if it was sent from one (its kind, for example *Annotation, from proposals*, the project and the text; for a practice task only *A practice task*, as practice projects are private), screen, browser, window size, the last error the app received and, from the crash message, the error.
4. Click **Mark as done** when the report is handled. Click **Reopen** to open it again.

Users send reports with **Technical problem…** in the user menu or **Report a technical problem…** in the editor; see [Report a technical problem](getting-started.md#report-a-technical-problem). Their task is not paused, and project leads do not see these reports. Each user sees their own reports and their status (*Open* or *Done*) under **Profile** › **My technical reports**, but not your name or the added details. A user can send at most 20 reports per hour.

Reports stay inside Ontotator. Nothing goes out by e-mail or to GitHub. To open an issue, click **Copy report** and paste the text by hand. Remove clinical content and patient details first.

Sending, closing and reopening a report are recorded in the audit trail, with the reference only. Reports are kept like the audit trail. When you [anonymise an account](#anonymise-a-deactivated-account), its reports stay under the pseudonym, and the browser recorded with them is erased.

## Upload ontology releases and translation files

What for: make a new ontology release (for example a newer HPO) or a translation file available to projects.

1. Click the gear at the top right and open **Ontologies**.
2. In **Ontology files**, choose one or more files: OBO Graph JSON ontologies (\`.json\`) or Babelon translation files (\`.tsv\`).
3. Click **Upload files**.
4. Read **Upload results**: **Added** or **Already present** per file.
5. For a translation file, a warning names the projects it does not reach.

Each file is stored on its own. If one file fails, earlier files may already be in the list below. Incomplete HPO releases are refused: a missing or obsolete main branch, or too many terms that do not reach the root. The message names the problem; upload a complete release instead.

### When a translation reaches a project

A project freezes its translations at the first use of its ontology, such as a term search or opening a text in the editor. A bundle import does not freeze them. The freeze records what each search ran with, so results stay comparable.

A translation file uploaded after that does not reach the project by itself. The project keeps searching with the files it froze. So upload translation files before anyone works in a project. The lead sees the frozen files in the project settings, see [See which translations the project uses](lead-settings.md#see-which-translations-the-project-uses).

To let a frozen project use a newer file, a lead of the project or a system administrator clicks **Use the newest translations** in its settings, see [Use the newest translations](lead-settings.md#use-the-newest-translations). Findings do not change, and earlier searches keep the record of the files they ran with. On the server, \`ontotator admin projects refresh-translations <project>\` does the same.

## Check the ontology inventory and which projects use a file

What for: see which releases are on the server and which projects use them.

1. On **Ontologies**, look at **Uploaded files**.
2. The table lists file name, kind, release, language, checksum and upload time.
3. **Pinned by** lists the projects that use (*pin*) a file. Click a project key to open its settings on the **Ontology** tab. Unused files read **Not pinned**.
4. **Frozen without** lists, for a translation file, the projects that froze their translations without it. The file does not reach them. Click a project key to see its frozen translations.
5. Click the copy icon next to a checksum to copy the full checksum.
6. Click **Refresh inventory** to reload the list.

To move a project to a newer release, upload it here, then follow [Move a started project to a newer release](lead-settings.md#move-a-started-project-to-a-newer-release).

## Create a project

What for: start a new project with its ontology and annotation scheme. Only system administrators can do this.

Before you start: [upload the ontology release](#upload-ontology-releases-and-translation-files) the project needs.

1. Click **Projects** in the sidebar, then **New project** above the list.
2. Fill **Project key** (2–63 lower-case letters, digits or hyphens) and **Name**. **Description** and **Languages of the texts** are optional.
3. Under **Profile source**, keep **Built-in template** and choose a template. Or choose **Upload profile JSON** and pick a task profile file. Which one you need: see [Task profiles](lead-settings.md#task-profiles).
4. For each ontology, choose the release in its ontology file field. With an uploaded profile, choose the file whose checksum the profile names. Optionally limit the allowed branches and choose the annotation scheme. With the template, HPO starts with the branch \`HP:0000118\` and the scheme **HPO phenotype (fixed qualifiers, modifiers)**; with an uploaded profile, the branches and the scheme start with what the file sets ([\`allowed_roots\`, \`t1_profile\`](lead-settings.md#what-a-profile-file-looks-like)), and the branches start empty (every term) if it sets none. The hint under an empty field says *Whole ontology*. A field that still shows the value from the file says *Loaded from the profile.*; the note goes once you change the field. What you enter here wins over the file.
5. Click **Create project**.
6. The project's settings open on **People**. [Add the lead](lead-settings.md#add-a-member) and the other members.

You are now a member of the project with the Lead role only, so you can manage it but get no annotation or consolidation work. If you do take part, [give yourself the role](lead-settings.md#change-a-members-roles). If you do not, [remove your role](lead-settings.md#change-a-members-roles) once a lead is added.

![New project form with key, name, template and ontology file filled in](images/admin-new-project.png)

The template fits only Ontospan bundles that use its ontology ID (\`hp\` or \`HP\`), its layer \`hpo-layer\`, exactly the branch \`HP:0000118\` and its values; for other bundles upload the matching profile. See [What must match a bundle](lead-settings.md#what-must-match-a-bundle).

The project key and the ontology of the task profile cannot be changed later. A project created by mistake can be [deleted](#delete-a-project-without-work) as long as nobody has worked in it. Everything else, such as name, workflow and members, is set in the [project settings](lead-settings.md).

## Open and manage any project

What for: as system administrator you can manage every project, also without a project role.

1. Click **Projects** in the sidebar, or **All projects** in the project switcher.
2. In the project's row, click **Open** to go to its documents, or **Settings** to change it.
3. Work as a lead would; see the [lead overview](lead.md).

## Delete a project without work

What for: remove a project that was created by mistake, for example with a wrong key, so it leaves every list and its key can be used again.

Only a project nobody has worked in can be deleted. Work is anything beyond the project's settings and members: texts, tool proposals, tasks, drafts and submissions, a guideline, a work plan, problem reports, final results and working time, and an upload that was committed. An upload that was only checked or discarded is not work.

1. Click **Projects** in the sidebar.
2. In the project's row, click **Settings**.
3. On the tab **General**, scroll to **Delete this project** at the bottom and click **Delete project…**. Only system administrators see it, and they see it in every project: whether the project has work is checked when you confirm.
4. Read the dialog and click **Delete project**.

You are taken to **Projects**, and a message confirms the deletion. The project goes with its settings, members, ontology pins, project API tokens and uncommitted uploads, and the next project may use its key. Its audit entries stay and name it by key; the deletion itself is recorded as well.

A project that has work is refused and stays as it was. The dialog then names the work it found, for example *This project has texts and a guideline, so it cannot be deleted.*, and offers only **Close**. A practice project is deleted under [Practice projects](#practice-projects).

## Move a project to another server

What for: copy one complete project, with its texts, work, history, guidelines and people, to another Ontotator server, or keep a copy of it.

A project archive is a ZIP file. It holds every record of the project, the stored files it uses and, for each person it names, the username and pseudonym, and the e-mail address of each person who worked in the project. Keep it as private as the project itself.

To export a project:

1. Click **Projects** in the sidebar.
2. Under **Project archives**, **Export a project**, choose the **Project**.
3. Keep **Include ontology files** ticked, unless the other server already has the same ontology and translation files.
4. Click **Export archive**. When **Archive ready** appears, click **Download archive**. When the archive is larger than this page accepts as an upload (300 MiB unless the operator changed it), the message says so: the operator then imports it on the other server on the command line.

An export is refused while an import or export of the project is still running. Download the archive within 24 hours: the server then deletes it, and at once when an account is erased. Export again to get a new one. The server also deletes an uploaded archive once its import has finished.

To import an archive on the other server:

1. Click **Projects** in the sidebar.
2. Under **Import an archive**, choose the file in **Archive file (.zip)**.
3. Click **Import archive**. When **Project imported** appears, it names the new project, the people matched to accounts here, the pseudonym-only people and any new pseudonyms in the copied work (for example \`ann-0005 → ann-0007\`).

Both servers must run the same Ontotator version: an archive from another version is refused. The import checks every file against the archive's manifest first and refuses a damaged or incomplete archive, one that would expand to far more than its size, and one whose records point to another project here. The manifest is not signed, so the check finds damage, not a deliberate change: only import archives from a source you trust. It then reads the imported project back and compares every table with the archive; a difference undoes the whole import. When the project key is taken here, the copy gets a suffix such as \`-2\`, and the name a suffix such as *(2)*; a copy of such a copy gets the next number (\`-3\`, *(3)*).

People are matched by e-mail address. A person with an account of the same e-mail address keeps the roles in the project. A person without such an account becomes a pseudonym-only person: an anonymised account with the person's pseudonym, without name, e-mail address or login. Work recorded under a pseudonym keeps that pseudonym. When the matched account has another pseudonym, the work stays with a pseudonym-only person that is linked to the account, and the account gets the person's roles. A pseudonym-only person can be linked to an account later on the command line (see the [operations guide](../operations.md#move-a-project-to-another-server)).

When someone here already has a pseudonym that the archived work carries, the import is refused. The same holds for work recorded under an annotator id without an account (for example from imported annotation files) when that id is a pseudonym here or names other work here. Tick **Give people new pseudonyms where theirs are taken here** to import anyway: such a person or annotator id gets a new pseudonym, and a person matched by e-mail gets the account's pseudonym, wherever the copied work records who did it. Texts, notes and guidelines are never changed.

## Practice projects

What for: see and remove the private practice projects of annotators and translation reviewers, and switch the offer on or off.

A practice project belongs to one person. It has invented texts only, and nothing done in it counts. Practice projects are never in your project lists, the project switcher, the Users page or the ontology inventory, and your administrator rights do not open them. Their actions go to the audit trail, marked as practice.

To see them:

1. Click **Projects** in the sidebar.
2. Tick **Show practice projects**. The number in brackets counts them.
3. Each row shows a **Practice** pill with the project key, the owner, the progress and the date it will be deleted.

To delete one, click **Delete…** in its row, then **Delete practice project**. Only that practice project goes; its audit entries stay. A real project can never be deleted this way.

A practice project is also deleted after 30 days without activity, and when its owner's account is deactivated. All practice projects are called *Practice project*, so no owner's name reaches the audit trail.

To switch the offer off:

1. Click the gear at the top right and open **Server settings**.
2. Under **Practice projects**, clear **Offer practice projects to annotators and translation reviewers**.
3. Click **Save changes**.

Off hides the card on **My tasks** and **Start practice** in the profile. Existing practice projects stay until they are deleted or expire.

A practice project freezes its translations like any project. A translation file uploaded later does not reach a practice project that is already in use, and the upload warning does not name practice projects. The owner gets the new file with **Reset…** in the profile.

## API tokens

What for: see every API token of the server, stop one, or create a system token for administration scripts.

1. Click the gear at the top right and open **Server settings**.
2. Go to **API tokens**. The table shows each token's **Kind** (*Personal*, *Project* or *System*), **Owner**, **Project**, **Scopes**, expiry, last use and **Status**.
3. To stop a token, click **Revoke…** in its row, then **Revoke token**. A token the server revoked by itself says why next to **Revoked**, for example *project role removed* or *password changed*.
4. To create a system token, click **New system token…**, enter a **Token name**, tick its scopes and click **Create token**. Copy the token from the dialog with **Copy token**; it is shown only once. Tick **I have stored the token**, then click **Close**; the dialog cannot be closed before.

Only a system token may hold the **System administration** scope, for ontology and translation uploads and user accounts. It acts as you and is revoked when you are no longer a system administrator, when you change your password and when your account is deactivated. Token creation, revocation and every change made with a token are in the audit trail.

On the server, \`ontotator admin tokens create\`, \`list\` and \`revoke\` do the same from the command line.
`,ee=`# Annotator reference

This chapter is for annotators and translation reviewers. It explains the editor, how to mark findings, check tool proposals and carried findings, submit a text and review a translation. Back to the [handbook overview](README.md).

New here? Start with [Your first task, start to finish](first-task.md). How to log in, find your tasks and open one is in [Getting started](getting-started.md). Words such as finding, mention, value field and modifier are explained in the [glossary](README.md#glossary).

## Contents

- Basics: [The editor screen](#the-editor-screen), [When is a task done?](#when-is-a-task-done), [Working time](#working-time)
- Findings: [Mark text and add a finding](#mark-text-and-add-a-finding), [Search a term](#search-a-term), [Browse the ontology tree](#browse-the-ontology-tree), [Set values and confirm defaults](#set-values-and-confirm-defaults), [Manage mentions](#manage-mentions-of-a-finding), [Add a finding without a text span](#add-a-finding-without-a-text-span), [Change term, note or delete a finding](#change-term-note-or-delete-a-finding), [Add modifiers](#add-modifiers-to-a-finding), [Undo, redo and reset](#undo-redo-and-reset-your-changes), [Turn a finding into a modifier](#turn-a-standalone-modifier-finding-into-a-modifier), [Work in several layers](#work-in-several-layers)
- Special tasks: [Review tool proposals](#review-tool-proposals), [Review carried findings](#review-carried-findings), [Re-create findings after a text correction](#re-create-findings-after-a-text-correction)
- Finishing: [Submit the text](#submit-the-text), [Confirm values and acknowledge warnings](#confirm-values-and-acknowledge-warnings-in-the-submit-dialog), [View your submissions](#view-your-submissions), [Start a new work round](#start-a-new-work-round)
- Problems: [Report a text problem](#report-a-text-problem), [Resume a paused task or withdraw a report](#resume-a-paused-task-or-withdraw-a-report)
- [Review a translation](#review-a-translation)
- [Keyboard shortcuts](#keyboard-shortcuts)

## The editor screen

![The editor: the findings list on the left, the text in the middle and the selected finding Hypotonia with its values on the right; the toolbar shows Annotate from scratch and Saved](images/annotator-editor.png)

The editor has three columns:

| Column | What is in it |
| --- | --- |
| Left: **Findings** | The list of your findings. In a task from proposals: **Review Proposals** and **Your own findings**. |
| Middle: the text | The text you annotate. Marked passages are highlighted. |
| Right: details | The selected finding: **Values**, **Modifiers**, **Note**, its mentions and the term search. With nothing selected, the **New finding** panel opens here when you mark text. |

The findings in the list follow the text: a finding stands where its first marked passage begins, so a finding you add in the middle of the text appears between its neighbours, not at the end. Findings without a text span come last. Carried findings stay at the top of the list, in the order of the earlier round.

To make the findings list wider or narrower, drag the divider between the findings list and the text (**Resize findings column**), or focus it and press \`←\` or \`→\`. On a narrow screen, the tabs **Findings**, **Document** and **Details** switch between the columns; **Back to text** returns to the text.

The toolbar shows the text name, its language and the mode:

| Mode | Meaning |
| --- | --- |
| **Annotate from scratch** | You see neither tool proposals nor other people's work. |
| **Annotate from proposals** | You see a tool's proposals, never other people's work. See [Review tool proposals](#review-tool-proposals). |
| **Review carried findings**, or the round name such as *Round 2, continued from Round 1* | Findings were carried over from earlier work. See [Review carried findings](#review-carried-findings). |
| **Check after text change** | The text was corrected and some findings are marked **Check needed**. See [Re-create findings after a text correction](#re-create-findings-after-a-text-correction). If nothing needs a check, the toolbar shows the round instead, such as *Round 1, carried over from the earlier text version*. |

Next to the mode, the save status tells you whether your work is stored: **Saved**, **Saving...** or **Unsaved changes**. Work is saved automatically; there is no save button. If it reads **Offline** or shows an error, click **Retry**.

The **More** menu holds **Work rounds**, **Report a text problem…**, **Report a technical problem…**, the guidelines (for example *Guidelines v2*), **Keyboard shortcuts (?)** and **Help for this screen**.

### The guidelines in the editor

Open the guidelines with **More** › *Guidelines v2* or, the first time, with the button in the notice, for example *Read guidelines v2*. On a wide screen they open in the right column, so the text keeps its place in the middle:

- The right column gets two tabs, **Details** and *Guidelines v2* (*Guidelines 3.1 (v2)* when the version has the lead's own number). Click a tab to switch, or focus a tab and press \`←\` or \`→\`.
- Selecting a finding in the list or in the text keeps the guidelines in front. The decision keys \`1\`, \`2\` and \`0\` act on the selected proposal from there.
- When you mark text, use the term search (\`/\`) or the values (\`V\`), or a decision needs a note (\`4\`, **Unresolved**), **Details** comes to the front by itself. The guidelines tab stays until you close it.
- **All versions** opens the guidelines page in a new tab. **Close**, the ✕ next to the tabs or \`Esc\` closes the guidelines and returns to **Details**.

On a narrower screen, or while you view an older version of your work, the guidelines open in a window over the page instead; on a phone they fill the screen.

If the text was changed elsewhere, a **Revision conflict** notice appears; click **Reload case**. A submitted task is read-only.

### Marks and badges

| You see | Meaning |
| --- | --- |
| Fill colour of a mark | The term. The same term keeps one colour in the text; the colour says nothing about the state. Different terms that overlap or stand close together in a sentence always have different colours. |
| Bands of colour | Text that belongs to several findings: one band per finding, in its colour. Up to three bands; with four or more findings the top band is striped. |
| Solid underline | Your own finding. |
| Dashed underline | A tool proposal under review. |
| Dotted underline | A read-only reference finding. |
| Diagonal hatching | A finding with the value **Absent**. |
| Thicker underline | Overlapping findings. |
| Frame | The finding you point at or selected. |
| **AI** | Proposed by a tool. Point at the badge to see which tool. A proposal carried over to a corrected text version names the tool that proposed it. |
| **Pending** | A proposal you have not decided yet. Decided proposals show **Confirmed**, **Rejected**, **Replaced** or **Unresolved**. |
| **Being replaced** | A proposal with your copy from **Edit & Replace** that has no changes yet. |
| **Defaults to confirm** | The finding still has prefilled values you have not confirmed. |
| **Check needed** | A carried finding you have not checked yet. |
| **Spanless** | A finding without a text passage. |

## When is a task done?

A task is done when you submit it. Before that:

- every finding the text states is marked, following the project guidelines;
- every value is chosen or confirmed (no **Default** left that you did not check);
- in a task from proposals, every proposal is decided;
- in a carried round, every carried finding is checked;
- you have read the whole text once more for findings you missed.

**Next open item** takes you to everything that still needs you. After you submit, the lead receives your work; see [What happens next](first-task.md#9-what-happens-next).

## Working time

What for: know what the timer in the toolbar counts, in projects that record working time.

A lead can switch on working time for a project. On your first task in such a project a notice, **This project records working time**, says so. The toolbar of an annotation task, and the bar of a translation review, then shows your own active time on this task, for example *12:05*, or *1:02 h* from one hour on. It adds up over all the times you opened the task.

- The timer starts when you open the task.
- It pauses by itself after 3 minutes without input (typing, clicking, moving the pointer, scrolling or selecting text) and while the tab or window is in the background. It then reads *auto-paused* and goes on with your next input. The 3 minutes before an automatic pause still count as working time, as reading time.
- Click **Pause timer** for a break. Input does not restart it; **Resume timer** or a change to your work does.
- A submitted or paused task shows no timer.

The project lead sees only sums per text and task type, never your single work periods. The research export lists the periods under your pseudonym.

## Mark text and add a finding

What for: record a term that the text mentions.

1. Select the words in the text with the mouse. With the keyboard: click before the first word (or press Tab until the text has focus), hold Shift and move with the arrow keys.
2. The panel **New finding** shows the marked text. To adjust it, drag the edge handles at its start and end, or focus a handle and press \`←\` or \`→\`.
   - On a phone, the text stays where it is and a **New finding** bar appears at the bottom of the screen. Tap **Choose term** to go on to the term search, or **Discard**. On a phone held sideways there is no bar: the panel **New finding** with the term search stands beside the text.
3. **Search term** is already filled with the marked words, and the hits are listed under **Terms**. Change the words, or type a code such as \`HP:0001250\`, if the right term is not among them.
4. Press Enter to add the top hit, or click a hit. Enter adds nothing when the top hit is a **Weak match**: click a hit, or choose it with \`↓\` and press Enter.
5. The finding is created with the project's prefilled values. [Confirm or change them](#set-values-and-confirm-defaults).

To drop a mark without adding a finding, click **Discard** or press Esc.

To look the marked words up elsewhere, for example in a web search, click the copy icon (**Copy text**) right after them or press \`Ctrl+C\` (\`Cmd+C\` on a Mac). Both copy the marked text of the new finding, or the selected (otherwise the first) mention of the selected finding or tool proposal, always in full and on one line: line breaks become spaces, and parts of a mention with words in between are joined by a space. Right after you mark text, \`Ctrl+C\` copies the whole marked text, although **Search term** holds it selected and may show only its first 80 characters. Text you have selected in a field yourself is copied as usual. Text you select in the text itself is copied as it stands, line breaks included, without the colours of the marks. Once copied, the icon shows a check for a moment; if the clipboard fails, a warning. The copy icon is also at each mention under **Mentions**.

## Search a term

What for: find the right ontology term quickly.

1. Press \`/\` or click **Change term** to focus the search.
2. Type a name or a code. Hits appear in the list **Terms**.
3. Move with \`↓\` and \`↑\`, or point at a hit (pointing skips a **Weak match**). Below the hits, the full definition of the active hit is shown; in a narrow window, scroll down to it. Read it, then press Enter or click the hit to take it, or press Esc to cancel. Enter and a click take the hit at once.

Search options:

- To search only modifier terms (severity, onset, …), switch on **Modifiers only**, or type \`mod:\` before the word.
- The language of the text is searched too. To search names in other languages, click the language button next to the field (it lists the languages searched, for example *EN, DE*) and tick them under **Search languages**. English names are always searched.
- Hits tagged **Modifier** are modifier terms. Use one as a finding only if it names the finding itself; otherwise add it under **Modifiers**. Obsolete terms cannot be chosen.
- Hits tagged **Weak match** do not match your words closely: at least one word is not at the start of a word of the name, even allowing for a typo or a plural. They are listed last, and Enter takes one only after you choose it with \`↓\` or \`↑\`. If all hits are weak, the line under the field says "no close match".

The search compares the words you type with term names and synonyms, letter by letter; it does not understand what they mean. Terms whose name or synonym equals your words come first. Next come terms whose name or synonym contains all your words, those with the fewest other words first. Other similar terms follow in a shuffled order, weak matches last, so the best one is not always on top. Read the hits before you choose one. If nothing matches, try another word or a synonym, type a code or switch search languages.

## Browse the ontology tree

What for: pick a broader or narrower term than the one you have, or look at the neighbours of a term before you decide.

1. Select a finding and click **Show in tree**. The **Ontology tree** opens at the current term.
2. Click a term in the tree. Its **Synonyms**, **Translated names** and other parents (**Also under**) are shown.
3. Click **Use this term** to give the selected finding this term.
4. Click **Close tree**.

**Show in tree** is also there where you cannot, or not yet, change a term. The tree then opens only to look: a note under its header says so, and clicking a term only shows its details.

| Where | **Show in tree** opens the tree at | Taking a term |
| --- | --- | --- |
| A proposal you have not decided yet | the proposed term | **Use this term instead…**, then **Confirm**: you get a copy with that term, as with **Edit & Replace**, and the proposal reads **Replaced**, for example *Proposal: decide as Changed with Seizure (HP:0001250)* |
| A hit of the term search of a **New finding** (next to the definition of the highlighted hit) | that hit | **Use this term instead…**, then **Confirm**: the new finding gets the term, as if you had chosen the hit, for example *New finding: choose Seizure (HP:0001250)* |
| A reference, other people's findings in a consolidation, a decided proposal, or your own finding in a submitted or read-only task | its term | not possible: there is no button |

The confirmation names what happens; **Cancel** or \`Esc\` closes it and changes nothing. Nothing changes until you click **Confirm**.

In a wide window the tree sits under the annotation panel. To give the tree more or less room, drag the divider between the two (**Resize ontology tree**) up or down, or focus it and press \`↑\` or \`↓\`. A double click or \`Enter\` restores the usual split. The height is kept in this browser.

In a low window (for example 1280 × 600) the open tree takes the whole right column. The annotation panel shrinks to one line above the tree: the marked words and the term of the finding. **Use this term** changes the term in that line too. **Show finding** brings the whole panel back above the tree, with the divider; **Hide finding** gives the tree the column again. When you close the tree, the panel is back as before.

On a tablet or a phone held sideways, the tree stands in place of the annotation panel, beside the text. The selected finding stays marked in the findings list and in the text. Close the tree to bring the panel back.

To give the tree more room, click **Hide details** next to the name of the term below the tree: only its name and code stay, on one line. **Show details** brings the definition, synonyms and other parents back. Your choice is kept in this browser.

The tree follows your work: select another finding, a proposal or a reference and it opens at its term, with the button that fits there. After **Use this term** it stays open and marks the new term as the current one; after **Confirm** it stays with the finding that now has the term. While you search a term for a new finding it steps aside and comes back afterwards, unless you opened it from a hit of that search. Clear the selection, or select something without a term, and it closes.

## Set values and confirm defaults

What for: record the context of a finding: whether it is present, who has it and when.

1. Select the finding. The section **Values** lists each value field, such as the assertion (**Present**, **Absent**, **Uncertain**) or the experiencer (**Patient**, **Family member**, …). Press \`v\` to jump there with the keyboard.
2. Read the passage in context. "No seizures" is **Absent**; "his mother has seizures" is not the patient.
3. To change a value, choose another one. Value fields with few values are buttons; others are a dropdown.
4. Values the project prefills are tagged **Default**. They count as not confirmed until you confirm or change them. If all shown values are right, click **Confirm defaults** or press \`d\`. This confirms every default of this finding. To confirm one default only, click its highlighted button on a button field, or **Confirm** next to a dropdown field.

Findings with open defaults show **Defaults to confirm** in the list.

![A new finding on “seizure”: under Values, Present, Patient and Current are tagged Default, with the Confirm defaults (3) button above them](images/annotator-finding-values.png)

## Manage mentions of a finding

What for: link a finding to every place in the text that supports it.

1. Select the finding.
2. Use the action you need:
   - **Add mention**, then mark the text: adds another place. Esc cancels.
   - **Add segment** on a mention, then mark the text: adds a second piece to the same mention, for words that are apart.
   - Drag a mention's edge handles, or focus an edge and press \`←\` or \`→\` (\`Ctrl+←\` / \`Ctrl+→\` moves by word): resizes it.
   - **Move to a new finding**: gives one mention its own finding with the same term and values. The new finding is selected, so you can change it right away; modifiers stay with the original finding.
   - **Remove**, then **Yes, remove**: detaches the mention.

You cannot remove the last mention when the project requires a text span. If the project allows findings without a span, enter a reason in the note first.

## Add a finding without a text span

What for: record a finding that the text implies but does not state in one passage.

Before you start: the project must allow findings without a text span. Otherwise the button is inactive.

1. In the **Findings** header, click **Add finding without a text span**.
2. In the panel **New finding without a text span**, fill in **Reason for no text span** (if the project requires a reason).
3. Search and choose the term. If you chose the term first, click **Add finding**.
4. The finding is listed as **Spanless**.

Click **Cancel** to stop. The reason is kept as the finding's note.

## Change term, note or delete a finding

What for: correct a finding you made.

1. Select the finding.
2. Use the action you need:
   - **Change term**, then search a new one: changes the term and keeps the mentions. The search starts with the words of the first mention, as for a new finding; type over them to search something else.
   - **Note**: type a comment. It is saved with the finding and the lead can read it.
   - **Delete finding**, then **Yes, delete**: deletes the finding and all its mentions. The message that follows offers **Undo**. Undo puts the finding back with its mentions, values, note and modifiers.

A deleted finding can also be put back later with **Undo** in the header, see [Undo, redo and reset your changes](#undo-redo-and-reset-your-changes). A restored carried finding may need a new check.

If a term has become obsolete, the panel says so. Change the term or delete the finding.

## Add modifiers to a finding

What for: add severity, onset, pattern and similar details to a finding.

1. Select the finding. In **Modifiers**, click **+ Add modifier…**, type into **Search modifier** and choose the modifier.
2. Optional: to link the modifier to the words that state it, click **Link a text span** and mark the text.

Every modifier row names the modifier and its code, for example *Severe · HP:0012828*, followed by the linked words. The line *Modifiers:* in the findings list names the codes too, as do the text view and the consolidation.

You can also start from the text:

1. Mark the words, for example "severe", and pick a modifier hit.
2. The panel asks which finding it belongs to. Click the finding in the list or in the text. The nearest ones are listed under **Nearest in this sentence:**.
3. If the modifier names the finding itself, choose the option to use it as the finding instead.

To change a modifier later, open its row menu: **Link a text span…**, **Remove text span** or **Remove modifier**. A removal can be undone with **Undo** in the message or in the header.

A tool proposal's modifiers change the same way while the proposal is open; see [Review tool proposals](#review-tool-proposals).

## Undo, redo and reset your changes

What for: step back through your own changes before you submit, or start the round again.

- **Undo** and **Redo** in the header step back and forward one change at a time. One change is one action: adding, deleting or moving a finding, changing its term, text span, a value, a modifier or the note, or deciding a proposal. A note counts once it is saved. Values you change on one finding in quick succession are saved together, so they are one change. Point at the button to see the step, for example "Undo: delete finding Seizure".
- \`Ctrl+Z\` (macOS: \`Cmd+Z\`) undoes, \`Ctrl+Shift+Z\` (macOS: \`Cmd+Shift+Z\`) or \`Ctrl+Y\` redoes. Inside a text field these keys undo your typing instead.
- **More** › **Reset all my changes…** returns the task to how this round started, after a confirmation: the tool proposals are all open again, the carried findings are back as they were, or the task has no findings. The reset is one step, so **Undo** brings your changes back. While nothing has changed in this round, the item is unavailable and says so.

Every undo, redo and reset is saved like any other change, and the history stays after a reload. A new change after an undo drops the steps you could redo. Undo and reset are not available after submitting, in a paused or read-only task, or in a consolidation.

## Turn a standalone modifier finding into a modifier

What for: fix a finding that is really a modifier of another finding.

1. Select the finding. A warning says it is a modifier term.
2. Click **Turn into modifier…**.
3. Click the finding it belongs to. The list marks candidates with **Becomes a modifier of the finding you choose**.

## Work in several layers

What for: work in projects with more than one layer (for example two ontologies). With one layer this panel is not shown.

1. Open **Layers & Ontologies** in the findings list.
2. Use the visibility toggle next to a layer to show or hide it. Layers tagged **Reference** are read-only.
3. Click **Activate** on the layer you want to annotate. **Locked** layers cannot be edited.
4. Choose the **Annotation type** for new findings.

## Review tool proposals

What for: check a tool's proposals one by one and add what the tool missed. Your mode reads **Annotate from proposals**.

Tools make mistakes. Check every proposal as if you had marked it yourself: the marked text, the term and every value. Negations are a common error: a proposal for "Keine Krampfanfälle" (no seizures) with **Present** is wrong.

1. The list **Review Proposals** shows every proposal. Your additions are under **Your own findings**.
2. Select a proposal, or move with \`j\` and \`k\`. The text shows where it was found. On a phone, where the details replace the text, the details show the sentence around the quoted passage, with the passage marked.
3. Check the marked text, the term and each value. To see the broader and narrower terms of the proposed term, click **Show in tree** under it; to replace the term with one from the tree, click **Use this term instead…** and **Confirm** (see [Browse the ontology tree](#browse-the-ontology-tree)). To look the passage up elsewhere, click the copy icon (**Copy text**) next to the quoted passage in the details, or press \`Ctrl+C\` (\`Cmd+C\` on a Mac): both copy the passage of the selected proposal, as for a finding ([Mark text and add a finding](#mark-text-and-add-a-finding)). A proposal with several mentions has the copy icon at each.
4. Decide:
   - **Confirm**: the passage, term and all values are right. Values tagged **Defaulted** were not set by the tool but prefilled; Confirm accepts them as shown, so check them too.
   - **Reject**: the proposal is wrong and nothing should replace it.
   - A wrong or missing modifier: change it right in the proposal's **Modifiers**, with **+ Add modifier…**, **Remove modifier** or **Link a text span…**, as on your own finding. The line *A change makes your copy of the proposal (Edit & Replace).* says what happens: the first change makes your copy (as **Edit & Replace** does), the change goes to the copy, and the proposal is **Replaced**. The copy's details open with the line *Your change made a copy; the proposal is decided as Replaced.* and **Undo**, which takes back the copy and the change together: the proposal is open again. For **Link a text span…**, the copy is made once you mark the text. A decided proposal, or one with a copy, lists its modifiers without these controls.
   - **Edit & Replace**: the proposal is nearly right. You get an editable copy that replaces it; correct the term, values or text span in the copy. The copy is listed indented under its proposal in **Review Proposals**, as *Your copy*, with the line *replaces this proposal*, not under **Your own findings**. The row shows *No changes yet* or what you changed, for example *Assertion: Present → Absent*. The proposal reads **Being replaced** until the copy differs, then **Replaced**. In the details, the editor names the proposal it replaces and what you changed. Click **Done, back to the proposal** when you are finished. The proposal then reads *Replaced by* with the term and your changes. If the copy has no changes, Done removes it and the proposal is open again. Confirming a default in the copy changes no value, so the proposal is not replaced by that alone. While the copy exists, the proposal's button reads **Open your copy**.
   - **Unresolved**: only if you really cannot decide; the other three decisions are the normal case. Write a **Reviewer note** saying why, then click **Save decision**. The proposal is submitted with your note and a reviewer flag. It does not block submitting. Another annotator's Confirm does not settle it: the finding does not count as agreed, and whoever decides, the consolidator or the lead, sees your flag and note. Only **Confirm** confirms a proposal's prefilled values: on an unresolved proposal they stay recorded as defaults, and its row shows **Defaults not confirmed**. The result line under **Your own findings** counts such a proposal as unresolved, for example "1 confirmed proposal, 1 unresolved proposal, 1 own finding".
5. After each decision, the next open proposal is selected. Press \`k\` right after a decision to go back to it.
6. When all proposals are decided, read the whole text again and add findings the tool missed: mark text that has no proposal, choose the term in **New finding** and set the values, as in [Mark text and add a finding](#mark-text-and-add-a-finding). Your additions appear under **Your own findings**, next to the proposals.

To undo a decision without a copy, click **Reset decision (open)** or press \`0\`.

To drop your copy, click **Discard copy**, in the copy's details or in the proposal's details, or press \`0\` on the proposal. The copy is removed and the proposal is open (**Pending**) and selected again. A copy without changes goes at once. A changed copy asks first and names the changes you lose; click **Discard copy** to confirm or **Keep editing** to keep it.

**Unresolved** is a flag for the lead, not clinical uncertainty. For clinical uncertainty ("possible seizures"), use the value **Uncertain**.

![The tool proposed “Keine Krampfanfälle” (no seizures) as Present. The annotator chose Edit & Replace: the editable copy keeps Seizure and sets the assertion to Absent](images/annotator-proposal-review.png)

## Review carried findings

What for: check findings that were carried over from an earlier round, for example after you continued from your submission, or after the text changed and your work moved to the new version. When a lead reopens your submission, nothing is carried: you continue on your submitted work as it was.

1. The toolbar names the round, for example *Round 2, continued from Round 1*, or reads **Review carried findings**. The progress line counts checked findings.
2. Click **Next unchecked** (or press \`n\`) to select the next finding marked **Check needed**.
3. Read **What to check**: the text span, the values or the note. For a finding without a text span the note is listed as its **Reason for no text span**. Carried values are not confirmed.
4. Optional: to see the finding as it was, click **Show original evidence**. It names who made the finding; in a consolidation of a project that hides annotator names, it reads *Annotator A*, *Annotator B* and so on.
5. If it is right (after any edits), click **Mark as checked** or press \`c\`.
6. If it does not apply to this text, open **Does not apply…**, give a reason and click **Dismiss**.

If you change a finding after checking it, it needs a new check.

In a task from proposals, your decisions on the proposals are carried to the new version: accepted, edited and added findings come along, and only those in a changed passage, or without a matching proposal in the new version, are marked **Check needed**. A proposal you rejected that has no counterpart in the new version is dropped. One you left **Unresolved** keeps its note.

A row **Not on this text** means the finding could not be placed in this text. Select it and choose one: **Mark in text**, **Link to an existing finding**, or **Dismiss with reason…**. A finding re-created with **Mark in text** keeps the original's term, values and note.

### See what changed since the earlier version

When the carried work comes from an earlier version of the text, for example after **Carry to v2…** or **Handle text change…**, the line above the text offers **Show changes since** v1 (with the number of that version). It is off by default.

1. Tick **Show changes since** v1 (or press \`Space\` on it). Each changed passage gets a dashed frame, and added text is underlined. The line next to it counts the passages, for example *1 passage changed*.
2. Click **Next ›** or **‹ Previous** to scroll to the next or previous passage; it gets a solid frame and the line reads, for example, *1 passage changed · 1 of 1*.
3. Where text was removed, a small **−** marker stands in the text. Point at it or move to it with \`Tab\` to see the earlier wording, with the removed words struck through. \`Esc\` closes it. On a phone or tablet, tap the marker: the earlier wording stays until you tap the marker again or tap somewhere else.

The marks are only shown over the text: the text stays exactly this version, so you can mark text, add or re-create findings and check carried findings as usual while they are on. A changed sentence the tool did not propose a finding for may need a new finding. The marks compare the two versions word by word, while **Check needed** is decided from the exact characters under each finding, so a finding inside a marked passage is not always marked **Check needed**, and the other way round. Untick the box to hide the marks.

![A carried finding with What to check and the Mark as checked button](images/annotator-carried-finding.png)

## Re-create findings after a text correction

What for: move your findings to the corrected text after the text got a new version, for example from a translation review, a lead's correction or an upload, and your task moved to it. The toolbar reads **Check after text change** while findings are marked **Check needed**. This works the same in a task from proposals: only findings in changed passages need you; your other decisions on the proposals are already carried.

1. The panel **Needs review after the text change** lists the findings to place again.
2. For each item, click **Re-create here** and mark the supporting text in the corrected version.
3. Check the term, then click **Save re-created finding**. You can choose a different term below.
4. Check the text span and the values of the saved finding, then click **Complete text-change review**. A later change to the finding needs this again.

If the finding no longer fits, click **Dismiss with reason**, fill in **Reason for dismissal** and click **Save dismissal**.

To see which passages the correction changed, tick **Show changes since** v1 above the text ([See what changed since the earlier version](#see-what-changed-since-the-earlier-version)).

### After a typo fix by the lead

When the lead fixes only spacing or a typo in a text you already submitted (**Fix typos…**), your annotation can move to the new version by itself: when every one of your findings is placed on the new text without doubt and no number in the text changed. You do nothing. In **My tasks** the text then shows its new version, for example *case-0465 de v2 corrected*, as **Submitted**; the task on the old version is gone. **View** shows the corrected text with your findings, placed on it. It is still your annotation: nothing was added or removed. If a finding marked words the lead changed, or a number changed, your annotation stays on the old version and the lead moves it the usual way; you then check the carried findings ([Review carried findings](#review-carried-findings)).

## Submit the text

What for: hand your finished work to the lead.

Before you start: submitting says you checked the whole text for further findings, not only the ones you marked. See [When is a task done?](#when-is-a-task-done).

1. Click **Next open item** to jump to things that still need attention.
2. Click **Finish & submit text**. While items are open, the button shows how many. The full editor of a consolidation has no submit button; see [Work in the full editor](consolidator.md#work-in-the-full-editor).
3. A dialog named after the text, for example *Submit CASE-1 en?*, first counts the findings and names those you left **Unresolved**, for example *34 findings, 1 unresolved, nothing open.* Then it lists what is still open: **Carried findings to check**, **Findings that need attention**, **Findings after text correction**, **Proposals not decided**. Click **Go to** to fix an item.
4. When nothing blocks, click **Submit text**. If only warnings are left, the button reads **Submit with** and the number of warnings; see [Confirm values and acknowledge warnings](#confirm-values-and-acknowledge-warnings-in-the-submit-dialog) first.
5. The next open task opens, preferably one of the same kind (another review after a review), or **My tasks** if none is left. It is the first such task in the order of **My tasks** ([See your tasks](getting-started.md#see-your-tasks)). Paused tasks are passed over. To see what you sent, click **View result** in the message.

The task is now read-only. To change it later, [start a new work round](#start-a-new-work-round) yourself under **More** › **Work rounds**; you do not need the lead for that. The submit dialog says the same.

## Confirm values and acknowledge warnings in the submit dialog

What for: finish prefilled values and modifier warnings without leaving the dialog.

Check each value before you confirm it. **Confirm as shown** says "I checked this value and it is right"; it is not a way to make the warning go away. A value you leave unconfirmed is submitted as shown, but recorded as *defaulted*, not chosen. The lead and the export see this difference.

1. The group **Values not chosen yet** lists findings with prefilled values.
2. Click **Go to** to check a finding in the text and change a value. If the shown values are right, click **Confirm as shown** on the row, or, with more than one row, **Confirm all as shown**.
3. The group **Modifier warnings** lists, for example, a modifier used as a finding or two severities on one finding. Click **Go to** to fix one.
4. Click the submit button. Warnings you leave are submitted as they are; the group **Values not chosen yet** says so in one line.

If the project requires chosen values, unconfirmed values block submitting instead of warning.

![The submit dialog with the Values not chosen yet group](images/annotator-submit-dialog.png)

## View your submissions

What for: look at what you submitted earlier.

1. Open the task. On a narrow screen, switch to **Details**.
2. Under **My submissions**, click **View** next to a round.
3. The dialog **Historical submission** shows the findings, values, notes and decisions of that submission.
4. Click **Close**.

## Start a new work round

What for: change your work after you submitted it, or start over. A submission itself never changes; a new round replaces it once you submit the round.

1. Open the task, then open **More** and choose **Work rounds**.
2. The table **Rounds** lists each round with its state and submission. **You are here** marks the current one; **Open** opens another.
3. Under **Start a new round**, choose one:
   - To continue from your work: choose the submission under **Continue from**, read what the dialog says will happen, and click **Continue from this submission**. Your findings are carried into the new round, and each must be checked again ([Review carried findings](#review-carried-findings)). You can do this yourself; you do not need the lead.
   - To start over: click **Start empty round**. The new round has no findings. This button is there only while the task has no round and no submission yet. After a submission, only your lead can restart it: [report a text problem](#report-a-text-problem) and ask for a restart. The new round has none of your findings; a task from proposals starts again on the newest tool proposals, all open.
4. Click **Close**, make your changes and [submit the text](#submit-the-text) again.

What happens to your earlier work:

- The earlier round stays in the history and is marked *Replaced by Round 2* (or the next number). Starting a round does not change the final result.
- Your earlier submission no longer counts as submitted. Your task shows **Open** in **My tasks** again, with **Continue**, and the number after **My tasks** in the sidebar counts it again.
- The lead sees your task as not submitted, and a new consolidation cannot start from the replaced submission. The lead can still read it.
- If the lead had already accepted your earlier submission as the final result, the lead is asked to review that choice.
- You must [submit](#submit-the-text) the new round to hand in your work again.
- While your submission is being consolidated, you cannot continue from it. The dialog then shows no choice and no button under **Start a new round**, only: *Your submission is being consolidated, so you cannot continue from it now. Ask your project lead.* The lead can finish the consolidation or withdraw it; after that the dialog offers your submission again.
- In a task from tool proposals you cannot continue from a submission yourself. The dialog says: *In a task from tool proposals you cannot continue from a submission yourself. Ask your project lead to start a new round.*

## Report a text problem

What for: tell the lead that the text cannot be annotated as it is, for example cut off or the wrong text. For questions about the rules, ask your lead directly instead. For an error message, a crash or something that does not load, use [Report a technical problem](getting-started.md#report-a-technical-problem): it goes to the administrators and does not pause your task.

Before you start: a report pauses your task. You cannot save or submit until the pause is released. Your saved work stays.

1. Open **More** and choose **Report a text problem…**. In a translation review or consolidation, use the button **Report a text problem** in the header.
2. Describe the problem under **What is the problem?**. Only you and project leads can read it.
3. Click **Report and pause my task**.

While your task is paused, and after you submitted it, the menu item reads **Text problems**, for example *Text problems (Paused, 1 open)*. The dialog is named after the text, for example *Problems with CASE-1 de*. It lists **Your reports** and offers **New report**.

## Resume a paused task or withdraw a report

What for: continue work after a report, or take a report back.

A paused task shows a one-line banner *Task paused: …* above the text with the reason. Click **Show more** to read all of it, **Show less** to fold it again. A term search in a task that was paused while you had it open is answered with the reason of the pause, not with terms.

1. Open **More**, then **Text problems**. Your report card shows its state and your task's state.
2. Choose one:
   - To continue: click **Resume my task…**, fill in **Why can you continue?** and click **Resume my task**. The card confirms it, for example *Resumed. The report stays open.*, and the dialog shows *Your task: Active*. The report stays open for the lead.
   - To take the report back: click **Withdraw report…**, fill in **Why are you withdrawing it?** and click **Withdraw report**. Your task is no longer paused by this report.

When the lead answers, the task shows a banner with **Open the answer**, and **My tasks** shows **Answer to your report**. If a project lead paused the task, only a project lead can release the pause.

### A task paused by the lead

The lead can pause the work on a text, for example while the text is being clarified. Your task stays in **My tasks**, marked **Paused by lead** with the lead's reason. You can open and read it; a banner *Paused by lead: …* above the text gives the reason. You cannot save or submit until the lead releases the text. Then the mark goes away and you continue where you stopped. There is nothing for you to do meanwhile.

- If the pause arrives while you have the task open, the next thing you do there (a term search, a saved change, a submit) is refused and the banner appears. In a narrow window or on a phone, where one pane shows at a time, the **New finding** panel repeats the reason (*Paused by lead: … Nothing can be saved now. What you marked is kept until you leave the task.*), because the banner is above the pane you work in. Nothing you saved is lost. What you had typed but not saved stays on the screen until you leave the task; when you leave, the editor asks before it discards it.
- A task you are assigned on a paused text is paused from the start.
- A task can be paused by the lead and by a problem report at the same time. **My tasks** then shows **Paused** with the report's reason and **Paused by lead** with the lead's. Each is released on its own, and the task opens when neither is left: after you resume your report, the task may still be **Paused by lead**.
- Your submitted tasks are not paused.

## Review a translation

What for: check a machine or human translation before it is annotated. Your task is *Translation review*.

Before you start: your profile must contain your **Qualification** ([Edit your profile](getting-started.md#edit-your-profile)). A submitted review cannot be changed.

What to check: compare each paragraph with the source. Look for the problems the app lets you record:

| Category | Look for |
| --- | --- |
| **Omission** | Something in the source is missing in the translation. |
| **Addition** | The translation says something the source does not. |
| **Negation or certainty** | "no", "possible", "suspected" lost or changed. |
| **Number or unit** | Numbers, doses, units, dates. |
| **Anatomy or laterality** | Body parts, left and right. |
| **Terminology** | A clinical term translated wrongly or too loosely. |
| **Problem in the source** | The source itself is wrong or unreadable. |

Then decide:

| Decision | Use it when | What happens next |
| --- | --- | --- |
| **Accepted unchanged** | The translation is right as it stands. | It becomes available for annotation. Annotation tasks already assigned open by themselves. |
| **Accepted with corrections** | You corrected it and it is now right. Editing chooses this for you. | Your corrected text is saved as a new text version, which is accepted for annotation. |
| **Query** | The meaning may differ clinically and you are not sure. | Not accepted. The lead reads your rationale and decides: they take the text you proposed, or accept the translation as it is, and answer you. Annotation tasks already assigned keep waiting until then. |
| **Rejected** | The translation changes the clinical meaning. | Not accepted. The lead decides: a new review, a correction or discarding it. Annotation tasks already assigned keep waiting. |

A problem in the source that does not affect the translation is no reason for a **Query**. Examples: a dose that looks too low but is what the source says, a footnote digit stuck to a year, a word broken by a hyphen at a line end. If the translation gives the source correctly, accept it (**Accepted unchanged**, or **Accepted with corrections** if you corrected something else) and put your remark in the **Rationale**. It is kept with your review. The lead reads the **Rationale** of every review, also of an accepted one, under **Translation reviews** in the text card and in the list of all translation reviews. A **Query** holds the annotation of the text until the lead decides; keep it for a translation you are not sure about.

Steps:

1. Open the task. The **Source** is on the left, the **Translation** on the right.
2. Read the automatic checks band at the top. Click **Details** to see which checks failed and why.
   - The band may also read *More passages in brackets than in the source: 2 in the translation, 1 in the source*. Ontotator found this itself, on the version you review. A translation sometimes adds a second name in brackets, for example a lay term followed by the Latin or English term; one finding is then named twice. **Details** lists the passages. If the translation added one, remove it; your decision is then **Accepted with corrections**. If you are not sure, choose **Query** with the category **Addition**. If the passages are right, decide as usual: this check asks for no rationale and is not counted in **My tasks**.
3. Type your corrections directly in the translation column. Your edits are saved as you type, and the decision switches to **Accepted with corrections**. Use **Show changes** to see your edits, also a double space you typed, and **Couple scrolling** to scroll both columns together. **Show matching paragraph** (\`Alt+M\`) jumps to the paired paragraph.
4. Optional: to compare with another text, click **Compare** above the texts. With several texts to compare, it opens a menu. In the review of a later version (v2, v3, …), the first entry is the previous version ([Review a later version](#review-a-later-version)).
5. Under **Your review**, choose a **Decision** (or press \`1\` to \`4\`).
6. Fill in what the decision needs:
   - **Query** and **Rejected** always count as a clinically relevant change: choose at least one category and write a **Rationale**. Put your question for the lead in the rationale.
   - **Accepted with corrections**: tick **Clinically relevant change** if your correction changes the clinical meaning; then a category and a **Rationale** are required.
   - **Accepted unchanged** after a failed automatic check: say in the **Rationale** why the flagged difference is correct.
7. Click **Submit review…** (or press \`Ctrl+Enter\`), read what will happen, then click **Submit review**.
   - If the text has spacing errors or invisible characters, the confirmation says so, for example *2 typography hints in your text: double space (2).* Click **Show them** to see each place with a little text around it; spaces are drawn as dots. To fix them, click **Keep editing**. The line blocks nothing: you can submit all the same. It names a double space, a space before or a missing space after punctuation, spaces at the end of a line or of the text, tabs, invisible characters and a doubled full stop. It does not find two words run together or a grammar slip; read your corrections once more.
8. A message confirms the review, with **View result**. Your next open task opens on its own, another translation review first, or **My tasks** if none is left. If you also annotate this text and your review finished its translation, your annotation of the text opens instead and the message adds *Annotate this text now*. Finished means: the translation is accepted (with corrections, on the corrected version), every other translation of the text is accepted too, and no further review or decision of the lead is pending. After **Query** or **Rejected** it does not come first.

On a wide screen, **Your review** is a column on the right. To give the texts more room, drag its left edge (**Resize review panel**), or focus the edge and press \`←\` or \`→\`; \`Enter\` restores the default width. **Collapse review panel** folds it to a narrow strip: the bar at the bottom then shows the decision and **Submit review…**, and **Expand review panel** or **Change ↓** opens it again. Width and folding are remembered in this browser.

After a **Query** the lead decides. **My tasks** then shows *Answer from the lead* at your submitted review (tab **Submitted**). Open the task: above **Submitted review** you read what was decided, for example *The lead decided your query on 18 Nov, 10:12. Your text was accepted as v2.* (or *v1 was accepted as it is.*), and the lead's answer, for example *Answer from the lead: Yes, as proposed.*

A project lead who corrects a translation themselves sees only **Accepted with corrections**. When the lead corrects a translation that was already accepted, the corrected version is reviewed again: it then appears as a new translation review task, usually for you ([Correct a translation yourself](lead-results.md#correct-a-translation-yourself)).

#### Why the lead asked for this review

When the lead asked for the review with **Ask a reviewer to correct…**, or reopened a review you had submitted, the lead's words stand above **Decision**:

- *Second review requested by the lead on 17 Nov, 14:30: Check the dose in paragraph 2.* The same line is under the task name in **My tasks**.
- *Added by the lead on 17 Nov, 16:05: Paragraph 3 as well.* The lead can add to the reason while your review is open; each addition stands below the reason, with its date, here and in **My tasks**.
- *Reopened by the lead on 18 Nov, 10:00: The unit is mg in my copy.* In **My tasks** it stands under the task name, as the reason for a second review does; on a narrow screen it stands under the **Reopened** badge. Without a reason from the lead it ends with *No reason given.*

A reopened review starts again from the text of its version; your earlier decision is listed under **Previous reviews**.

#### Review a later version

What for: review a translation that already has an earlier version, for example a text the lead uploaded with **Upload a corrected text…** or corrected, or a version another reviewer corrected. The text name in **My tasks** and in the task ends with the version, for example *case-0101 de v2 corrected*.

The task shows the version you were given, not the first one:

- **Translation details** says how this version was made: **This version** (for example *Human translation*, *Machine translation, DeepL, deepl-2026-10*, *Corrected by hand*, *Corrected by the project lead*, *Corrected in a translation review* or, after **Fix typos…**, *Typos fixed by the project lead on 17 Nov, 10:12* with **What was fixed**), when it was uploaded or corrected, the **Version before** and, for an uploaded text, what the lead recorded about who made it and when. The machine translation run of the first version is listed separately, for example *Translation run of v1*. On a phone the details open below the bar across the width of the screen.
- The line under the translation reads *Same as the version you were given (v2).* Your own edits are underlined against that version, and **Show changes** shows them.
- **Compare** shows what changed since the version before. Click **Compare** (with several texts to compare, choose *The previous version (v1)*): the third column, *Changes from v1 to v2*, shows this version with the removed passages struck through and the added ones underlined. **Close** hides it again.
- The automatic checks ran on the first version only. The band says so, for example *The automatic checks ran on v1, not on this version (v2). 1 automatic check failed on v1: Units added in translation.* **Details** lists the checks of v1. A check that failed on v1 is not counted in **My tasks** for this task, and **Accepted unchanged** needs no rationale because of it. Check yourself whether the passage is right in this version. Only the check for passages in brackets is made on this version itself.

#### Review a source update

If the source text was updated after the translation was made, **Source updates to review** appears above **Decision**. The **Source** column of the task still shows the original source.

1. Choose **Accepted unchanged** or, after correcting the translation, **Accepted with corrections**, and fill in what the decision needs.
2. Under **Source updates to review**, click **Review source update**.
3. Compare **Original source** and **Updated source** with **Current translation**. In the updated source, added text is underlined and removed text is struck through.
4. Click **Submit review and resolve source update**. This submits your review and resolves the source update.

**Submit review…** alone does not resolve a source update. If you use it with an accepting decision while one is open, the confirmation says so, for example *1 source update is not reviewed.*, and offers **Review source update**, which opens the comparison. **Submit without the source update** accepts the translation against the original source and leaves the update open: the submitted review can then no longer resolve it, and the lead has to assign another review.

![A translation review: the source on the left, the translation on the right, the failed automatic check above them. On the right, Query is chosen with the category Number or unit and a rationale, above Submit review…](images/annotator-translation-review.png)

### Mark checked sentences

What for: keep track of the sentences you have already checked in a long text.

1. Tick **Mark checked sentences** above the texts. Both texts are now split into sentences. To edit the translation again, untick it. **Show changes** is off while you mark. Your choice is remembered in this browser.
2. Click a sentence to mark it as checked. Click it again to remove the mark. Source and translation are marked separately.
3. Shift+click a sentence to mark all sentences from the last one you clicked up to this one.
4. Or press on a sentence and drag across others. Starting on an unmarked sentence marks all of them. Starting on a marked sentence removes the marks.
5. The head of each text shows how many of its sentences are checked. **Next unchecked** jumps to the first unchecked sentence of the translation.

Checked sentences are green. If you edit a checked sentence later, it turns amber, and the head of the text counts it as *changed*. Read it again, then click it to mark it as checked.

A mark belongs to its sentence, not to its wording. When a text repeats a sentence, for example *Unauffällig.*, and you edit the one you had checked, that sentence turns amber where it stands; the same sentence elsewhere in the text stays as it was, unchecked if you had not checked it. When you add or remove text before checked sentences, their marks move with them. A checked sentence you delete loses its mark; if you take an edit back, the sentence is green again.

The marks are only for you. They are saved with your review, so they are kept when you reload, close the tab or the task is paused. With the review open in two tabs, both keep their marks; a tab shows the marks of the other one after your next mark there or after **Reload from server**. They do not change your decision, and the lead and the exports never see them.

With the keyboard: Tab to a sentence, then press Enter or Space to mark it. Shift+Enter marks the range from the last sentence you marked.

On a touch-only device such as a phone or tablet, **Mark checked sentences** is not offered, because a swipe on the text has to scroll. A review you can only read does not offer it either.

### Show invisible characters

What for: see spacing errors and characters you cannot see otherwise, such as a double space, a tab or a non-breaking space.

1. Tick **Show invisible characters** above the texts. Your choice is remembered in this browser. While the box is ticked, a line below it names the marks: *Marks: · space, ° non-breaking space, → tab, ¶ line end, ¬ soft hyphen, | zero-width character*.
2. Read the marks in all texts:

   | Mark | Character |
   | --- | --- |
   | grey dot \`·\` | space; two dots are a double space |
   | arrow \`→\` | tab |
   | small circle \`°\` | non-breaking space |
   | amber bar between two characters | zero-width character, for example a zero-width space |
   | small \`¬\` above the line | soft hyphen |
   | \`¶\` | end of a line; a dot before it is a space at the end of the line |

3. Correct the translation as usual. Untick the box to hide the marks again.

The marks only change what you see. They are not part of the text: selecting, copying and saving give the text without them, and the lines break where they broke before. The marks also show with **Show changes** and **Mark checked sentences**.

Ontotator does not correct anything by itself, and a mark never blocks your review.

## Keyboard shortcuts

What for: work without the mouse. Shortcuts are off while you type in a field or when a dialog is open. Letter keys work in lower and upper case alike. **Keyboard shortcuts (?)** in **More**, or \`?\`, lists the shortcuts of the current screen, grouped for example under *Finding*, *Decisions* and *Carried findings*. A key that needs something first, such as a selected finding or proposal, is listed with *(not available right now)*. Many buttons also show their key next to the label.

| Key | Action |
|---|---|
| \`/\` | Focus the term search |
| \`↓\` / \`↑\`, Enter | Move through term hits; add the active hit |
| \`v\` | Focus the values |
| \`d\` | Confirm all default values of the selected finding |
| Esc | Discard the marked text, clear the selection, cancel adding a mention |
| Shift+arrow keys | Select text with the keyboard (after clicking into the text) |
| \`←\` / \`→\`, \`Ctrl+←\` / \`Ctrl+→\` | Move the focused mention edge |
| \`j\` / \`k\` | Next open / previous proposal. Right after a decision, \`k\` goes back to that proposal. |
| \`1\` \`2\` \`3\` \`4\` | Confirm, Reject, Edit & Replace, Unresolved |
| \`0\` | Reset the decision to open, or discard your copy of the proposal |
| \`n\` / \`Shift+N\` | Next / previous unchecked carried finding |
| \`c\` | Mark carried finding as checked |
| \`Ctrl+Z\` (macOS: \`Cmd+Z\`) | Undo the last change |
| \`Ctrl+Shift+Z\` or \`Ctrl+Y\` (macOS: \`Cmd+Shift+Z\`) | Redo |
| \`Alt+←\` / \`Alt+→\` | Previous / next text |
| \`Alt+P\` | Switch project |

In a translation review: \`1\` to \`4\` choose a decision (outside the text), \`Ctrl+Enter\` submits (with a confirmation), \`Alt+M\` shows the matching paragraph. With **Mark checked sentences** on, Enter or Space marks the focused sentence and Shift+Enter marks a range.
`,te=`# Consolidator

This chapter is for consolidators. A consolidation merges two or more submissions on one text into one result: findings that everyone agrees on are taken over, and you decide the rest. Back to the [handbook overview](README.md).

How to open tasks is in [Getting started](getting-started.md). How a lead starts a consolidation and accepts the result is in [Lead: results, decisions and export](lead-results.md#start-a-consolidation). Reporting a text problem works as in the [annotator reference](annotator.md#report-a-text-problem).

## Typical consolidation, start to finish

1. Open **My tasks** and click **Start** in the row whose task is **Consolidation** ([Open a consolidation task](#open-a-consolidation-task)).
2. Open the project guidelines (the guidelines button in the header) and keep them at hand ([How to decide](#how-to-decide)).
3. Read the whole text once. The underlines show who marked what.
4. Click **Next open group**. For each open group, read the passage in context, choose the right value in each highlighted row with ✓ and click **Keep** ([Decide a group in the ✓ table](#decide-a-group-in-the--table)). Drop findings the text does not support with **Not in result**.
5. If the guidelines did not settle a group, write a **Note for the lead** and tick **Guidelines unclear here**.
6. Add any finding everyone missed ([Add a finding everyone missed](#add-a-finding-everyone-missed)).
7. When the progress card reads **Ready to submit**, click **Submit consolidation** and confirm ([Finish a consolidation](#finish-a-consolidation)).
8. The lead reads your result, your notes and flags, and accepts it as the final result.

## How to decide

Decide each group by the text and the project guidelines, as if you were annotating it yourself.

- Not by majority. Two people can make the same mistake. If two of three said **Present** for "No muscular hypotonia", the right value is still **Absent**.
- Not by seniority. Whose finding it was does not matter.
- Read the passage in context. Check negation ("no", "without"), who has the finding (patient or family member), and when (now or in the past).
- Prefer the term the text supports. Usually that is the most specific term the text states; follow the guidelines if they say otherwise.
- If none of the versions is right, use **More…** › **Other term…** or **Edit values…** ([Edit values or pick another term](#edit-values-or-pick-another-term)).
- If the guidelines do not settle it, decide as well as you can, write a **Note for the lead** and tick **Guidelines unclear here**. The lead sees both and can improve the guidelines.

Open the guidelines with the guidelines button in the header, for example *Guidelines v2*, or *Guidelines 3.1 (v2)* when your lead gave the version its own number ([Read the project guidelines](getting-started.md#read-the-project-guidelines)).

## Groups and their states

Ontotator puts the findings that different people marked on overlapping passages into one *group*. You decide a group as a whole.

| State | Meaning |
| --- | --- |
| **agreed** | Everyone who marked it chose the same term and values. It is already in the result and counts as decided. Open it and click **Reopen** if it is wrong. |
| **to decide**, or *2 fields to decide* | Still open. The number counts the highlighted rows that still need your choice and goes down with each ✓. When every row has one, the group reads *chosen, not saved yet* until you click **Keep**. |
| **Conflict** mark | People chose different terms or values. |
| **to decide** without **Conflict** | Only the passage differs, not everyone marked the finding, or an annotator left it unresolved. |
| **Related terms** tag | The people chose a term and its parent or child, for example *Seizure* and *Status epilepticus*. A line under the **Term** row says which is the parent, for example *Seizure is a parent term of Status epilepticus.* A smaller difference than two unrelated terms, but still a choice: pick the term that fits the text. |
| **Unresolved** tag | An annotator could not decide this finding. It is not agreed, even if everyone marked the same: read the note in the **Unresolved** row of the table, then decide. |
| **decided** | You decided it. |
| **not in result** | You left it out. |
| **attached** | A modifier term you attached to another finding. |

A new consolidation already shows agreed groups as decided, for example *4 of 8 groups open · 4 decided*.

## Open a consolidation task

What for: start or continue your consolidation work.

1. In **My tasks**, find the row whose task is **Consolidation**.
2. Click **Start**, **Continue** or **View**.
3. The consolidation screen opens. Its heading reads, for example, *Consolidate CASE-1 en v1*. The path above it shows how many groups are still open.

If the project hides annotator names, the screen says *Annotator names are hidden in this project.* The annotators are then *Annotator A*, *Annotator B* and so on, in the order they submitted, everywhere in this consolidation; their names are not shown to you. If the lead starts another consolidation round on the same task, each annotator keeps their letter and someone new gets the next one.

If the lead gave a reason when starting the consolidation, it shows above the groups, for example *Reason from the lead: Term and assertion differ*, and under the task in **My tasks**.

If the lead reopened a consolidation you had submitted, a line above the groups says when and why, for example *Reopened by the lead on 18 Nov, 10:00: The onset is still open.* In **My tasks**, click the **Reopened** badge to read it. A consolidation the lead withdrew is no longer in **My tasks**; ask the lead why.

The header holds **Open in full editor**, **Report a text problem** and, if the project has guidelines, a button such as *Guidelines v2*. **More…** appears once you decided a group.

The screen is read-only after you submitted, when the task is no longer yours, when it is paused, or when a submission used here was withdrawn. A banner tells you which.

A paused consolidation shows a banner above the groups and no decision buttons, no **Add finding** and no submit bar; your decisions so far are kept and can be read. Click **Show more** in the banner to read how it continues:

- *Task paused: …* with the reason of a problem report, yours or one the lead paused your task for. If you reported it yourself, click **Text problems** in the header, then **Resume my task…**; otherwise wait for the lead's decision ([Resume a paused task or withdraw a report](annotator.md#resume-a-paused-task-or-withdraw-a-report)).
- *Paused by lead: …* with the lead's reason: the lead paused the work on this text. It opens again when the lead releases the text ([A task paused by the lead](annotator.md#a-task-paused-by-the-lead)).

If the pause arrives while you have the consolidation open, the next decision is not saved and the group says so with the reason, for example *Decision not saved. The project lead paused the work on this text: …*; the banner appears and the buttons go. The full editor of the consolidation shows the same banner and is read-only as well.

## Read the text and walk the groups

What for: see who marked what and work through the differences in order.

1. The **Clinical text** shows one underline per person. The legend below says which line style belongs to whom. There are four line styles: with more than four people, the fourth (double) line stands for everyone from the fourth person on, and the legend lists them, for example *Line 4 (double): +5: …*. The table of a group still has every person. Kept findings are shaded; the selected group is framed.
2. Beside it, the list **Groups** holds the groups in text order, each with its passage and [its state](#groups-and-their-states).
3. One group is open at a time. Click a group, or a marked passage in the text, to open it.
4. Press \`j\` for the next open group and \`k\` for the previous one, or click **Next open group** on the progress card.

On a smaller screen, use **Hide text** and **Show text** to make room. On a phone-sized screen, each group shows its own text snippet instead. Without the text, **Add finding** stands above the groups ([Add a finding everyone missed](#add-a-finding-everyone-missed)).

## Decide a group in the ✓ table

What for: decide a group by choosing, per row, the value that is right.

1. Open a group. The table has one column per person. A robot icon marks findings from a tool proposal. With many people the table is wider than its box: scroll it sideways; the row names on the left stay in view. From four people on, a line under each highlighted row says who holds which value, for example *Hypotonia 14 · Abnormality of the nervous system 6 (C, F, I, L, O, R)*: the most frequent value first, then every other value with the people who chose it (their letters if the project hides annotator names). The line, the parent-term sentence of **Related terms** and an *(all agree)* value stay in view while you scroll. The numbers tell you who to compare, not what is right ([How to decide](#how-to-decide)).
2. The rows are **Term**, one row per value field (for example the assertion), **Text**, **Modifiers** (only if someone used modifiers) and **Note**. Rows where people disagree come first and are highlighted; *(all agree)* marks rows that need no choice, also the **Text** row when everyone marked the same passage. You can mix: take the term from one person and a value from another.
3. In each highlighted row, click the ✓ next to the value you want. Its button is named after the value, for example *Take Hypotonia … for Term*.
4. Read the result line below the table. It starts with "Result:" and lists what is still not chosen, for example *Term not chosen yet* or *text not chosen yet*. Once the term is chosen, **Not taken:** lists other people's terms that are not in the result.
5. Optional: click **+ note** to write a **Note for the lead**, and tick **Guidelines unclear here** if the guidelines did not settle the case.
6. Click **Keep**. The group reads **decided**, the message **Decision saved** appears with **Undo**, and the next open group opens. While a dialog is open, the message is hidden; it is back when the dialog closes. A note shows under the closed group in the list, so you and the lead see it without opening the group.

![An open group with the comparison table, the ✓ choices for Hypotonia and Absent, and the Keep button](images/consolidator-group-table.png)

**Keep** stays inactive until every highlighted row has a choice. Value colours only help you scan; they carry no meaning beyond the value.

Special cases:

- Not everyone marked it. The card names who did, for example *Ana Weber, Luc Martin marked this. Tom Reis has nothing here.* If someone rejected the tool proposal the finding comes from, the card says so, for example *Tom Reis rejected the proposal.* The button reads **Keep the finding**, or *Keep Luc Martin's finding* for one person. Keep it only if the text supports it.
- Different passages. If people marked overlapping but different passages, the group is open without a highlighted row. The **Text** row shows each person's passage; the ✓ of the passage that goes into the result is pressed, and the result line names it, for example *text "Absent reflexes"*. Compare the underlines in the text. To use another person's passage, click its ✓; its note comes with it. Then click **Keep**. For a passage nobody marked, [work in the full editor](#work-in-the-full-editor).
- Modifiers. Each modifier is named with its code, for example *Severe HP:0012828 “schwere”*, and has its own ✓, so you can combine modifiers that different people chose. Modifiers of one kind, such as two severities, exclude each other. If someone linked a modifier to a different finding, the card says so, for example *Ben Roth linked "Severe" (Severe) to Hypotonia.* Check which finding the text means.
- Same term twice. If the same term is already in the result from another group, the card warns you. **Keep** then adds a second finding with that term.

## Leave a finding out of the result

What for: drop a finding that the text does not support, that breaks the guidelines, or that duplicates another one.

1. Open the group.
2. Optional: write a **Note for the lead** if the reason is not obvious.
3. Click **Not in result**. The group reads **not in result**.

To take it back, click **Undo** in the message, or open the group later and click **Reopen**.

## Attach a modifier to a finding

What for: when someone used a modifier term (such as "Severe") as a finding of its own, turn it into a modifier of the right finding.

1. Open the group. The card says that a modifier term was used as a finding.
2. Click **Attach to a finding…** and choose the finding from the menu. The menu holds the decided findings of the same sentence. While none is decided, the button is inactive and says *Decide the finding it belongs to first.*: decide that group, then come back. If the sentence has no other finding, it says *This sentence has no finding to attach it to.*
3. The group reads **attached**. The target group lists the modifier under **Attached modifier:**.

## Edit values or pick another term

What for: keep a finding with a value or term that nobody chose.

1. Open the group and click **More…**. It is offered when no row is in conflict or when the terms differ.
2. Choose one:
   - **Edit values…**: set each value and the modifiers, then click **Keep with these values**. This is offered only when no row is in conflict.
   - **Other term…**: search and pick a term; the search works as in the editor ([Search a term](annotator.md#search-a-term)) and shows the full definition of the active hit below the hits. If there was no term conflict, it is saved at once; otherwise choose the remaining highlighted rows with ✓ and click **Keep**.

In **Edit values…**, click **Cancel** to stop without changes. The term search of **Other term…** has no **Cancel**: press Esc or click outside it to close it without a change.

## Add a finding everyone missed

What for: add a finding that no submission has.

1. Select the passage in the text. Or click **Add finding**, type the passage into **Passage from the text** (choose the **Occurrence** if it appears more than once) and click **Continue**.
2. Search and pick the term. Read the definition of the active hit below the hits before you press Enter or click it.
3. A message confirms the new finding. It is listed under **Added by you** with its values, which start as the project's defaults (for example *Present, Patient, Current*). Its value fields open right away: change what the text says, for example **Assertion** to *Absent* for a negated finding, and click **Save values**. Click **Cancel** to keep the defaults.
4. To change the values later, click **Edit values…** next to the added finding.
5. To take a finding out that you added by mistake, click **Remove** next to it and confirm with **Remove** under *Remove this finding?*. A message confirms it (*Finding removed: …*). There is no Undo: add the finding again if you need it.

If the passage is not found, type it exactly as written, or select it in the text.

On a phone-sized screen, and while the text is hidden, there is no text to select: click **Add finding** above the groups and type the passage exactly as written. The text snippets of the groups show the wording around the marked passages; for any other passage, use a wider screen.

## Change or undo a decision

What for: correct a decision you made.

1. Choose what fits:
   - Right after a decision: click **Undo** in the message, or press \`Ctrl+Z\` (macOS: \`Cmd+Z\`) while you are not typing in a field. This undoes the last decision only.
   - Later: open the decided group and click **Reopen**. Decide it again.
   - Only the note or the flag: use **Edit note** and **Save note**, or the **Guidelines unclear here** box. These save at once.
2. To start over: open **More…** in the header and choose **Reopen all decisions…**, then **Reopen all**. Groups where everyone agreed are taken over again; every other group opens without a choice. The message offers **Undo** until your next change: once you decide a group, add or change a finding, or edit a note, the reopened decisions cannot be restored, and the message goes. **Undo** then belongs to that new decision only.

If you changed a group in the full editor, reopening it drops that edit. You are asked to confirm.

## Finish a consolidation

What for: hand the merged result to the lead.

Before you start: after you submit, you cannot change the consolidation.

1. When no group is open, the progress card reads **Ready to submit**.
2. Click **Submit consolidation**.
3. The dialog **Submit consolidation?** says who accepts the result (*The lead then accepts the result.*; if you are the lead yourself: *Then accept the result in Documents.*) and shows how many groups and findings the result has, and how many are not in the result. If you kept a modifier term as a finding, it already names that finding, for example *1 finding uses a modifier term (such as Severe) as the finding itself: Neonatal onset "since birth"*. Click **Go to group** to close the dialog and open its group.
4. Click **Submit**.
5. If there are warnings (values filled in by default, a modifier used as a finding, two severities), the dialog now lists them under **Check before you submit**, and the button reads **Submit with** and the number of warnings. A modifier used as a finding is named with **Go to group**, as before the first click; a finding you added yourself is named with its passage and *added by you*. Click **Back** to fix them, or submit with warnings only if you checked that the values are right.
6. The screen confirms: *Consolidation submitted. The lead then accepts the result.* (If you are the lead yourself: *Consolidation submitted. Accept the result in Documents.*) Open your next task or click **Back to my tasks**.

While groups are open, **Submit consolidation** stays inactive and says how many groups are left.

![The Submit consolidation? dialog: the summary of groups and findings, Check before you submit with one warning, and the buttons Back and Submit with 1 warning](images/consolidator-submit-dialog.png)

What happens next: the lead reads the result with your notes and flags, and accepts it as the final result or chooses another result. If you notice a mistake after submitting, tell the lead: they can start a new consolidation, which can include yours.

## Work in the full editor

What for: change text spans or add findings that the comparison table cannot express.

1. Click **Open in full editor**.
2. The editor shows the mode **Consolidate** and the list **Selected submitted findings** with each finding's author, or *Annotator A*, *Annotator B* and so on if the project hides annotator names. *Replaced by* on a submitted finding shows which result finding took its place; point at it for a short explanation, click it to jump to that finding. The editor works as described in the [annotator reference](annotator.md), except that it has no submit button. **Show in tree** on a submitted finding or a reference opens the ontology tree at its term only to look: you take no term from there. The tree shows terms only, nothing about the people.
3. Click **Back to consolidation** at the end of the toolbar to return. Next to it the editor says *Submit on the consolidation screen.*

Groups you changed here are tagged **edited in editor** on the consolidation screen. You submit the consolidation only there, with **Submit consolidation** (see [Finish a consolidation](#finish-a-consolidation)).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| \`j\` / \`k\` | Next / previous open group |
| \`Ctrl+Z\` (macOS: \`Cmd+Z\`) | Undo the last decision |
| \`?\` | Show all shortcuts of this screen |

## Read others' work in the text view

If you also lead the project, you can open the text view of a text you consolidate to read each person's findings side by side. See [Read a text and other people's work in the text view](lead-documents.md#read-a-text-and-other-peoples-work-in-the-text-view).

If you do not lead the project, read the other people's findings on the consolidation screen and in the [full editor](#work-in-the-full-editor). The text view shows you the text and your own submitted results only. Its **Submissions** list also names the submissions you consolidate, as plain rows without a link; only your own rows are marked *(you)* and open in the viewer. The **Text card** belongs to **Documents**, which is for project leads, so the text view offers it to leads only.

For a lead: when a submission was carried over from an earlier version of the text, the text view of it offers **Show changes since** v1 (with the number of that version). It marks the changed passages as described for annotators in [See what changed since the earlier version](annotator.md#see-what-changed-since-the-earlier-version); the consolidation screen itself does not show them. On a phone, the text view lists the findings of the shown work below the text, which keeps the full width.
`,ne=`# Frequently asked questions

Short answers to problems people often meet. Each answer links to the chapter with the full steps.

Your problem is not listed? For an error message, a page that does not load or a crash, [report a technical problem](getting-started.md#report-a-technical-problem) to the system administrators. For questions about the texts or the rules, ask your project lead.

## Logging in

### I forgot my password

Ask a system administrator for a reset code. Ontotator sends no e-mail. Then click **I have a setup or reset code** on the login page and set a new password. See [Set your password with a setup or reset code](getting-started.md#set-your-password-with-a-setup-or-reset-code). Administrators: see [Issue a new setup or reset code](admin.md#issue-a-new-setup-or-reset-code).

### The login says "Username or password is wrong, or the account is temporarily locked."

Check the spelling of your username. After 5 wrong passwords within 15 minutes, login for that username from your network is locked for up to 15 minutes; wait and try again. If you no longer know the password, ask an administrator for a reset code.

### My setup or reset code does not work

Codes work once and expire: setup codes after 7 days by default (the administrator can change this), reset codes after 2 hours. A newer code also cancels an older one. Ask an administrator for a new code. Capital letters, spaces and hyphens in the code do not matter.

### A login window appears while I am working

Your session has ended. Log in again in that window. Your unsaved edits stay in the open editor and are saved after you log in. See [Log in](getting-started.md#log-in).

### The page says "The page is out of date; reload it." or "Your page is out of date."

Reload the page in the browser, then repeat the last action. If the message asks you to, log in again ([Log in](getting-started.md#log-in)).

## Tasks and projects

### I see an error message that is not explained here

Open the user menu at the top right and click **Technical problem…**, or use **Report a technical problem…** in the editor under **More**. Describe what you did. Ontotator adds the last error it received. The report goes to the system administrators and does not pause your task. See [Report a technical problem](getting-started.md#report-a-technical-problem).

### The page says "Something went wrong while displaying this text."

The editor could not show the text. Your saved changes are kept on the server. Click **Reload case**. If it happens again, click **Report a technical problem…** on the same screen: the error message is added to the report for you.

### The page says "Something went wrong while displaying this page."

A screen outside the editor, such as My tasks, Documents or a page under Administration, could not be shown. Work that was already saved is kept on the server, and the sidebar still works: open another page there, click **Go to My tasks**, or click **Reload page**. If it happens again, click **Report a technical problem…** on the same screen: the error message is added to the report for you.

### The page says "The project is busy right now."

Another operation, often a running import, is holding the project. What you just did was not applied, so nothing needs undoing. Wait a moment and click **Retry**, or repeat the action. In the editor the save status says **Project busy – changes not saved**, and your unsaved edits stay on the page until the save goes through.

### After login I see Projects, not My tasks

Ontotator opens the project you used last. The first time, leads and administrators see **Projects** and everyone else **My tasks**. Click **My tasks** in the sidebar. See [Log in](getting-started.md#log-in).

### My tasks is empty

A project lead has not assigned you a text yet. Assigned texts appear under **My tasks** automatically. Also check the status tabs: **All** shows every task. See [See your tasks](getting-started.md#see-your-tasks).

### I see "You are not a member of any project yet."

Ask your project lead or an administrator to add you to a project, then click **My tasks** or reload the page. Leads: see [Add a member](lead-settings.md#add-a-member).

### A task opens with "Task not found or not yours"

The task was removed or given to someone else, or you followed a link meant for another person. Go back to **My tasks** ([See your tasks](getting-started.md#see-your-tasks)).

### My task is paused

A problem report pauses the task, yours or the lead's. A one-line banner *Task paused: …* above the text gives the reason; click **Show more** to read all of it. You can read your saved work but not change or submit it. If you reported the problem yourself, you can resume with a reason. If the lead paused it, only the lead can release it. See [Resume a paused task or withdraw a report](annotator.md#resume-a-paused-task-or-withdraw-a-report).

A task marked **Paused by lead** is paused because the lead paused the work on its text; the mark and the banner *Paused by lead: …* give the lead's reason. You can read the task and wait: it opens again when the lead releases the text. A save that is refused meanwhile says *The project lead paused the work on this text: …*; your saved work is kept. See [A task paused by the lead](annotator.md#a-task-paused-by-the-lead).

### My submitted task is read-only

A submission cannot be edited. To change your work, open the task, choose **More** › **Work rounds** and click **Continue from this submission**. Your findings are carried into a new round; check them, make your changes and submit again. See [Start a new work round](annotator.md#start-a-new-work-round). A lead can also reopen your task; it then shows **Reopened** with the lead's reason.

### A project cannot be deleted: "This project has … so it cannot be deleted"

Only a project nobody has worked in can be deleted, so that no texts, tasks or results are lost. A project with texts, tasks, a guideline or other work stays; the message names the work it found. See [Delete a project without work](admin.md#delete-a-project-without-work).

### I cannot open project settings, Ontologies or New project

Project settings are for project leads. **Ontologies**, **Users**, **Technical reports** and **New project** are for system administrators. The page tells you whom to ask. See [Roles](README.md#roles).

## Annotating

### Why is "Finish & submit" disabled?

Only for the moment a submit is running. Otherwise the button stays available, and if something is still open it shows how many items. Click **Next open item** to jump to one, or open the submit dialog: it lists every open item with **Go to**. Typical open items are undecided proposals, carried findings not yet checked, findings after a text correction, or values not yet chosen. See [Submit the text](annotator.md#submit-the-text).

### The submit dialog shows "Values not chosen yet"

Some findings still have prefilled values you did not confirm. Click **Confirm as shown** per finding, or **Confirm all as shown**, or **Go to** the finding and choose another value. In some projects you must confirm them before you can submit. See [Confirm values and acknowledge warnings in the submit dialog](annotator.md#confirm-values-and-acknowledge-warnings-in-the-submit-dialog).

### The submit dialog shows "Modifier warnings"

A finding uses a modifier term (such as a severity) as the finding itself, or has two modifiers of one kind. Check it with **Go to**. If it is correct, submit anyway with the button that names the number of warnings. See [Add modifiers to a finding](annotator.md#add-modifiers-to-a-finding).

### Submitting fails with "Replace obsolete terms" or "Replace unknown terms"

The project moved to a newer ontology release and a term in your draft, or in a proposal you confirmed, is retired or no longer exists there. Your task stays open and your draft is kept. Pick another term for that finding, or reject or replace the affected proposal. Then submit again. See [Change term, note or delete a finding](annotator.md#change-term-note-or-delete-a-finding).

### "Add finding without a text span" is disabled

Your project requires a text span for every finding. Mark the text passage instead. See [Add a finding without a text span](annotator.md#add-a-finding-without-a-text-span).

### The save status says "Changed elsewhere – reload required"

The same task was changed in another window or by someone else. Click **Reload case**. See [The editor screen](annotator.md#the-editor-screen).

### The save status says "Offline – changes not saved"

The connection to the server is lost. Keep the window open; your input stays in the editor. When the connection is back, saving usually resumes on its own; if the status stays, click **Retry**. See [The editor screen](annotator.md#the-editor-screen).

### The term search does not find the right term

The search compares your words with term names and synonyms; it does not understand meaning. Terms whose name or synonym equals your words come first, then terms whose name or synonym contains all your words; other similar terms follow in a shuffled order, those tagged **Weak match** last. Enter takes a weak match only after you choose it. Read all hits, then try another word, a synonym, the English name or a code. See [Search a term](annotator.md#search-a-term).

## Translation review

### I cannot submit my review: "Your qualification is required to submit."

Add your qualification (for example "physician, native German speaker") in your profile, then submit again. Use the link **Add your qualification in your profile**; after saving, **Back to the task** returns you to the review. See [Edit your profile](getting-started.md#edit-your-profile).

### What does "automatic check failed" mean?

The translation tool checked its own output and found a possible problem, for example numbers or units that differ from the source. Click **Details** to read the check, what the tool reported and what to do if the translation is right anyway. Open **Technical details** for the technical code of the check. If Ontotator has no description for a check, ask the project lead what it checks. See [Review a translation](annotator.md#review-a-translation).

A line *More passages in brackets than in the source* in the same band is a check of Ontotator itself on the version you review. It asks for no rationale ([Review a translation](annotator.md#review-a-translation)).

The checks of the translation tool run once, on the first version of a translation. In the review of a later version the band reads *The automatic checks ran on v1, not on this version (v2).* and names a check that failed on v1; it asks for nothing there ([Review a later version](annotator.md#review-a-later-version)).

## Consolidating

### Why is "Submit consolidation" disabled?

Some groups are still open. Decide each open group first; the progress card counts what is left. See [Finish a consolidation](consolidator.md#finish-a-consolidation).

### I submitted a consolidation with a mistake

A submitted consolidation cannot be changed. Tell the lead: they can start a new consolidation on the text, which can include yours as one of the submissions. See [Finish a consolidation](consolidator.md#finish-a-consolidation) and [Accept a consolidation](lead-results.md#accept-a-consolidation).

### "Could not add the finding. Nothing changed."

The finding was not saved, for example because the connection dropped. Reload the page and add it again. If it keeps failing, tell your lead. See [Add a finding everyone missed](consolidator.md#add-a-finding-everyone-missed).

### The consolidation asks me to "Check before you submit"

The result has findings with values filled in by default, modifier terms used as findings, or modifier warnings. Check them; if they are correct, submit with the warnings. See [Finish a consolidation](consolidator.md#finish-a-consolidation).

## Leading a project

### The app says "Guidelines v2", but our guideline is version 3.1

The number after *v* counts the guideline files published in this project; it is not the version of your document. When you publish, enter your document's version in **Your version of the guideline (optional)**. The app then shows it first, for example *Guidelines 3.1 (v2)*. A version that is already published keeps its name: publish the text again with your version to change it. See [Publish the first or a new guideline version](lead-settings.md#publish-the-first-or-a-new-guideline-version).

### I cannot accept a result

In projects where the consolidator of a text may not be one of its annotators, you cannot choose a result you made yourself. Another lead must choose it. See [Accept a result or compare results](lead-results.md#accept-a-result-or-compare-results).

### Undo after Reopen… or Withdraw open tasks… says "Undo is no longer possible: the texts changed since."

Undo of these bulk actions works once, for the lead who made the change, within an hour, and only while nothing changed on the texts since, for example nobody saved a draft and nobody was assigned. Reopen or withdraw the remaining tasks again, or assign the work anew. If the dialog itself says *The texts changed since the preview. Check the new preview.*, nothing was changed yet: read the new preview and confirm again. See [Reopen or withdraw the tasks of several texts](lead-documents.md#reopen-or-withdraw-the-tasks-of-several-texts).

### My uploaded texts do not show up

An import runs in the background; reload **Documents** when it is done. If the project plan for new imports is **Plan nothing; I plan texts on Documents**, the new texts show as *Not decided* until you plan them. See [Upload texts](lead-documents.md#upload-texts).

### The upload says "The file name is not a valid text ID."

For plain text, each file name without \`.txt\` becomes the text ID. Rename the file: letters, digits, dots, hyphens and underscores, up to 128 characters, starting with a letter or digit. See [Prepare files for upload](lead-documents.md#prepare-files-for-upload).

### I cannot change the ontology release or the task profile

The ontology release can be chosen freely only until the first work is submitted; after that, use **Move to another release**. The task profile can only be replaced before work starts, and only by a file with the same ontology ID as the project (upper and lower case count as the same) and the checksum of the chosen release. See [Move a started project to a newer release](lead-settings.md#move-a-started-project-to-a-newer-release) and [Replace the task profile](lead-settings.md#replace-the-task-profile).

### I uploaded a translation file, but term searches do not use it

The project froze its translations at the first use of its ontology. A later file reaches it only when a lead clicks **Use the newest translations** under **Settings**, tab **Ontology**, card **Translations**. Findings do not change. See [Use the newest translations](lead-settings.md#use-the-newest-translations).

### My bundle is refused: the ontology settings do not match

The check names, per text, what the bundle uses, what the project uses and who can change it: a lead changes the release, branches or annotation scheme under **Settings**, tab **Ontology**; the ontology ID of a project cannot change. See [What must match a bundle](lead-settings.md#what-must-match-a-bundle).

### A text has no assign button

The text is not in the work plan. Plan it first. See [Add a text to the plan](lead-documents.md#add-a-text-to-the-plan).

### "This person already submitted this review. To let them review it again, use Reopen."

You assigned a translation review to someone who already reviewed this version, for example after they rejected it. A second assignment is not possible; reopen their review instead: **Resolve…**, then the reopen item, for example *Reopen Ana Weber's review…*. See [Resolve a rejected or queried translation](lead-results.md#resolve-a-rejected-or-queried-translation).

### "This version can no longer be accepted here."

**Accept this version…** was refused: the version was accepted or reviewed meanwhile, a newer version exists, it was discarded, or a translation review of it is open. The dialog names the reason. Close it and look at the version list again. See [Accept one translation version](lead-results.md#accept-one-translation-version).

### "A new version cannot be uploaded here any more."

**Upload a corrected text…** was refused when you saved: a newer version of the translation arrived meanwhile, the translation was discarded, or a translation review of the version was assigned. The dialog names the reason. Close it and look at the version list again; your text is not saved, so keep it. See [Upload a new version of a translation](lead-results.md#upload-a-new-version-of-a-translation).

### "Fix typos…" did not save

**Fix typos…** did not save: a newer version arrived, a translation review of the version is open, it was discarded, or the text is the same as before. The dialog names the reason; your text stays in the dialog until you close it. See [Fix a typo in a translation without a review](lead-results.md#fix-a-typo-in-a-translation-without-a-review).

### "This query can no longer be decided here."

**Accept the reviewer’s text…** or **Answer and accept the version as it is…** was refused: the query was already decided, a newer version of the translation arrived, the translation was discarded, or a translation review of the version is open (withdraw it with **Remove…** first). The dialog names the reason. Reload the row to see its current state. See [Resolve a rejected or queried translation](lead-results.md#resolve-a-rejected-or-queried-translation).

### "Nothing can be added to this reason any more."

**Add to the reason…** was refused: the reviewer submitted the review, the task was removed, or the task is no longer the one you asked for with **Ask a reviewer to correct…**. An addition is possible only while the requested review is open. Reload the row to see its current state. See [Add to the reason of a correction request](lead-documents.md#add-to-the-reason-of-a-correction-request).

### A review of a version cannot be reopened or assigned after "Fix typos…"

*A lead fixed typos in this version: v2 is the text to review. Assign a review of the newest version.* A translation review always reviews the corrected text. In the row, use **Assign review…** or **Resolve…** › **Assign a new review…**; the person who reviewed the earlier version can be chosen again. See [Fix a typo in a translation without a review](lead-results.md#fix-a-typo-in-a-translation-without-a-review).

### A task is still paused after I closed the report

Closing a report does not always release the pause. The row shows **Resume task…**; click it and release the pause. See [Decide on a problem report](lead-results.md#decide-on-a-problem-report).

### I chose myself as consolidator: where do I work?

While your consolidation runs, **Open consolidation** in the text card opens your task, as does **Open my task** in the row on **Documents** or the row in **My tasks**. After you submitted, **Open consolidation** shows the read-only result. See [Start a consolidation](lead-results.md#start-a-consolidation).

### The consolidator list does not show a person

Only you and the members with the **Consolidator** role are listed; the hint under the list says so and links **Settings → People**. Give the role first. See [Change a member's roles](lead-settings.md#change-a-members-roles).

### "A final result was chosen for this text, so its annotation mode stays."

**Change mode…** is refused while the text has a final result. Withdraw it first: **Withdraw final…** in the text card's **Finalization**, then change the mode. See [Withdraw a final result](lead-results.md#withdraw-a-final-result).

### A new round is refused: a consolidation is open

*A consolidation is open on this text: finish or withdraw it first.* A submitted annotation gets no new round while a consolidation of its text is not submitted: the consolidation works on that submission. As an annotator, ask your lead. As a lead, wait for the consolidation, or withdraw its task in the text card and start the round then. **More actions** › **Start a round…** skips such texts for the same reason. See [Start a new round for several texts](lead-documents.md#start-a-new-round-for-several-texts).

### The export asks me to tick a box

Some texts still need your decision or have no final result. Either decide them in **Documents** first, or tick the box to export the ready results and leave the others out. See [Export final results](lead-results.md#export-final-results).

### "You already have several jobs waiting"

You have 3 exports or uploads waiting already; one more is refused until one of them has started. Wait a moment and try again. Download a finished export within 24 hours; after that the server deletes its file and you create it again. See [Export research data](lead-results.md#export-research-data).

### The Phenopackets could not be created

A final result holds something a Phenopacket cannot, for example findings of one text made under two HPO releases. **Technical diagnostics** names the text. The results with receipt are not affected: choose that format to export them. See [Phenopackets](lead-results.md#phenopackets).

### I cannot remove a lead

A project needs at least one lead. Add another lead first, then remove the role. See [Change a member's roles](lead-settings.md#change-a-members-roles).

### "Save changes" is disabled in the settings

Nothing has changed yet. The button turns on as soon as you edit a field. **People** and **Guidelines** save on their own and have no save button. See [Open project settings](lead-settings.md#open-project-settings).

## Administration

### I cannot close the setup-code dialog

Tick **I have handed over or stored the code** first. The code is shown only once. See [Hand over a setup or reset code](admin.md#hand-over-a-setup-or-reset-code).

### "You cannot remove your own administrator role."

This protects you from locking yourself out. Another system administrator must do it; you also cannot deactivate yourself. The last active system administrator always keeps the role. See [Edit a user's profile and administrator role](admin.md#edit-a-users-profile-and-administrator-role).

### An ontology upload is refused

The file could not be read, is too large, or is an incomplete HPO release. Read the detail below the message and upload a complete release. See [Upload ontology releases and translation files](admin.md#upload-ontology-releases-and-translation-files).

### A project archive import is refused

The message says why, and nothing was imported. An incomplete or damaged file (*damaged or incomplete*): export the archive again and copy it unchanged. A file that expands too far (*refused*): ask the operator, who can raise the limit. An archive from another Ontotator version: upgrade the older server, export the project again and import the new archive. Missing ontology files: upload them on **Ontologies**, or export the archive with **Include ontology files**. Pseudonyms that are taken here: tick **Give people new pseudonyms where theirs are taken here**, or give each person the same e-mail address on both servers. See [Move a project to another server](admin.md#move-a-project-to-another-server).

### A user sent a technical report

Click the gear at the top right and open **Technical reports**. Mark it as done when it is handled. Reports are not sent anywhere; copy one into an issue by hand and leave out clinical content. See [Handle technical reports](admin.md#handle-technical-reports).

### The administrator lost the password

This is fixed on the server, not in the app. See [Lost admin password](../operations.md#lost-admin-password) in the server operations guide.

### A script with an API token gets "The API token lacks the scope this needs."

The token was created without the scope the request needs, for example **Export** to start an export. Tokens cannot be changed: create a new one with the scope and revoke the old one. A token can also never do more than its owner may, and never annotation work. See [Create an API token](getting-started.md#create-an-api-token).

### A script's API token suddenly stops working

The token expired or was revoked. A new password, a reset code and deactivation revoke all of the owner's tokens. Losing the lead role revokes the owner's project tokens for that project, and losing the administrator role the owner's system tokens (and project tokens of projects they do not lead). A personal token is not revoked when its owner loses a role, but it can no longer do what the role allowed: a project that disappears from its answers or a 403 means exactly that. Check its **Status** under **API tokens** and create a new one if needed.
`,f=`# Your first task, start to finish

This chapter takes you through one annotation task, from your first login to a submitted text. Do it once in this order; afterwards, look things up in the [annotator reference](annotator.md). Back to the [handbook overview](README.md).

Before you start: you need the address of your Ontotator server, your username and a setup code from your administrator, and a lead must have assigned a text to you.

Want to try first? A private practice project with invented texts lets you do every step without it counting; see [Try it out in a practice project](getting-started.md#try-it-out-in-a-practice-project).

## 1. Log in

1. Open the address of your Ontotator server.
2. The first time: click **I have a setup or reset code**, enter your **Username**, the code and a new password twice, then click **Set password and log in** ([details](getting-started.md#set-your-password-with-a-setup-or-reset-code)).
3. Later: enter your **Username** and **Password** and click **Log in**.

## 2. Find your task

After login you see **My tasks**. Leads and administrators see **Projects** the first time.

1. Click **My tasks** in the sidebar.
2. On the tab **To do**, find a row whose **Task** is *Annotation, from scratch* or *Annotation, from proposals*. On a phone, the task and its status stand under the name of the text.
3. Click **Start**. A task marked **Waiting for translation review** cannot be started yet; it opens by itself once the translation review is accepted.

The editor opens. If you have no task, you see **No texts are assigned to you yet.**; ask your lead.

## 3. Read the guidelines

The first time you open a task in a project with guidelines, a notice asks you to read them. Click the read button in the notice, for example *Read guidelines v2* (or *Read guidelines 3.1 (v2)* when your lead gave the version its own number). Later you find them under **More** in the toolbar. On a wide screen they open in the right column, as a tab next to **Details**, so the text stays in view; see [The guidelines in the editor](annotator.md#the-guidelines-in-the-editor).

The guidelines tell you what to mark and how: which findings count, how much text to mark, how to handle negations or family history. When in doubt, follow the guidelines; if they do not answer your question, ask your lead.

## 4. Get to know the screen

The editor has three columns: the list of **Findings** on the left, in the order of the text, the text in the middle and the details of the selected finding on the right. The toolbar shows the mode, for example **Annotate from scratch**, and the save status. Everything is saved automatically; **Saved** means your work is stored. In a project that records working time, the toolbar also shows a timer with **Pause timer**; see [Working time](annotator.md#working-time). The dividers between the columns, and the one above the ontology tree when it is open, can be dragged to share out the room. See [The editor screen](annotator.md#the-editor-screen).

## 5. Mark a finding

1. Read the text from the start. When it names a finding, for example "seizures", select the words with the mouse.
2. The panel **New finding** opens. **Search term** already holds the marked words, and the hits are listed under **Terms**. The copy icon (**Copy text**) right after the marked words, or \`Ctrl+C\` (\`Cmd+C\` on a Mac), copies all of them on one line, for example to look them up in a web search; see [Mark text and add a finding](annotator.md#mark-text-and-add-a-finding).
3. Read the hits before you choose: the search matches words, not meaning, and only a term whose name or synonym equals your words is sure to be on top. If the top hit is the right term, press Enter; a hit tagged **Weak match** is added only after you choose it with \`↓\`. Otherwise, click another hit, or try another word or a synonym in **Search term**. If you picked the wrong term, click **Change term** in the finding: the search starts with the marked words again.

![The New finding panel with the marked text and the term search open](images/annotator-new-finding.png)

## 6. Choose the values

The new finding starts with the project's prefilled values, for example **Present** for the assertion and **Patient** for the experiencer. They are tagged **Default** and do not count as chosen yet.

1. Read the passage again in context. Does the text say the finding is there, absent ("no seizures") or uncertain? Is it the patient's or a family member's?
2. If a value is wrong, choose the right one under **Values**.
3. If all shown values are right, click **Confirm defaults** (or press \`d\`).

![A new finding on “seizure”: under Values, Present, Patient and Current are tagged Default, with the Confirm defaults (3) button above them](images/annotator-finding-values.png)

Repeat steps 5 and 6 for every finding in the text.

## 7. Check the tool proposals (tasks from proposals only)

In a task *Annotation, from proposals*, the column **Review Proposals** lists findings a tool suggested. Tools make mistakes, especially with negations: a tool may propose "Keine Krampfanfälle" (no seizures) as **Present**.

1. Select the first proposal. The text shows where it was found, and the line *Source* names the tool that made it.
2. Check three things: the marked text, the term and every value. To see broader and narrower terms of the proposed term, click **Show in tree**; the tree only shows terms until you confirm one.
3. Click **Confirm** if all three are right, **Reject** if the proposal is wrong, or **Edit & Replace** to correct it in a copy, listed under the proposal, then click **Done, back to the proposal**. Changing a value or the text span in the copy replaces the proposal; confirming a default alone does not. Changed your mind? Click **Discard copy**: the copy is removed and the proposal is open again. A changed copy asks first. Only if you really cannot decide, click **Unresolved** and write a **Reviewer note** saying why.
4. The next open proposal is selected. Go on until every proposal is decided.
5. Then read the whole text for findings the tool missed. Mark text that has no proposal and add the finding as in step 5. It appears under **Your own findings**, next to the proposals.

![The tool proposed “Keine Krampfanfälle” (no seizures) as Present. The annotator chose Edit & Replace: the editable copy keeps Seizure and sets the assertion to Absent](images/annotator-proposal-review.png)

Details: [Review tool proposals](annotator.md#review-tool-proposals).

## 8. Submit

Before you start: submitting means you checked the whole text, not only the findings you marked.

1. Click **Next open item** until nothing is left. It takes you to every proposal, value or finding that still needs you.
2. Click **Finish & submit text**. (A consolidation is submitted on its own screen; see [Consolidator](consolidator.md).)
3. The dialog counts your findings and lists what is still open, with **Go to** for each item. Values you have not confirmed are under **Values not chosen yet**: confirm them only if you checked that they are right. A value you leave is submitted as shown but recorded as defaulted, not chosen; the lead and the export see this.
4. Click **Submit text**.

![The submit dialog with the Values not chosen yet group](images/annotator-submit-dialog.png)

Details: [Submit the text](annotator.md#submit-the-text).

## 9. What happens next

- Your task shows **Submitted** in **My tasks**. It is read-only now; click **View** to look at it. A translation review you submitted as a **Query** shows *Answer from the lead* there once the lead decided.
- The next open task opens on its own, or **My tasks** if none is left.
- The lead sees your submission next to the other annotators' work on the same text, and accepts one result or starts a consolidation. You do not see other people's work.
- Your task is done. You do not need to do anything else unless the lead reopens it (**Reopened** in **My tasks**, with the lead's reason under the task name) or you notice a mistake. A translation review the lead asks for a second time names the lead's reason under the task, for example *Second review requested by the lead on 17 Nov, 14:30: Check the dose in paragraph 2.* If the lead adds to that reason later, each addition stands below it with its date (*Added by the lead on …*).

If you notice a mistake after submitting: open the task, choose **More** › **Work rounds** and click **Continue from this submission** ([Start a new work round](annotator.md#start-a-new-work-round)). Fix the finding, check the carried findings and submit again.

If something is wrong with the text itself (cut off, wrong patient, unreadable): **More** › **Report a text problem…** ([Report a text problem](annotator.md#report-a-text-problem)).

If a task in **My tasks** is marked **Paused by lead**: the lead stopped the work on that text for now and says why. You can read the task; it opens again when the lead releases the text ([A task paused by the lead](annotator.md#a-task-paused-by-the-lead)).

## If you were given a translation review

A *Translation review* task shows the source and the translation side by side. You correct the translation if needed and choose a decision. See [Review a translation](annotator.md#review-a-translation).
`,p=`# Getting started

This chapter is for everyone. It shows how to log in, find your tasks and keep your profile up to date. Back to the [handbook overview](README.md).

## Before you start

- Your administrator gives you the address of your Ontotator server, your username and a one-time setup code.
- Use a current version of Chrome, Firefox, Edge or Safari.
- Everything you do is saved automatically. There is no **Save** button in tasks, and you can close the browser tab at any time and continue later.

## Set your password with a setup or reset code

What for: your first login, or a new password after an administrator reset it.

Before you start: you need a setup or reset code from your administrator. A code works once. Setup codes expire after 7 days by default (your administrator can change this; the message with your code says when it expires), reset codes after 2 hours.

1. Open the address of your Ontotator server in your browser. You see the login screen.
2. Click **I have a setup or reset code**. The form **Set your password** opens.
3. Enter your **Username**.
4. Enter the code in **Setup or reset code**.
5. Enter a password in **New password**: 12 to 256 characters, different from your username.
6. Enter it again in **Repeat the new password**.
7. Click **Set password and log in**.

![The Set your password form with the fields Username, Setup or reset code, New password and Repeat the new password](images/getting-started-set-password.png)

Ontotator sets the password and logs you in at once. The first time, you land on **My tasks**, or on **Projects** if you lead a project or are an administrator (see [Log in](#log-in) for where you land later). Only if that login fails afterwards, for example because the account is locked for a while, the login screen opens with **Your password is set. Log in with it now.**; the password is set, so [log in](#log-in) with it later. If you see **The two passwords differ.**, type both passwords again. To go back without a code, click **Back to login**.

## Log in

What for: start working.

1. Open the address of your Ontotator server in your browser. You see the heading **Log in to Ontotator**.
2. Enter your **Username** and **Password**.
3. Click **Log in**.

After logging in, Ontotator opens the project you used last on this browser:

- annotators and consolidators see **My tasks** for that project;
- leads see the project's **Documents** page.

The first time, or if that project is no longer yours, you see **My tasks**; if you lead a project or are an administrator, you see **Projects** instead. Click **My tasks** in the sidebar to see your work. On **Projects**, **Needs your decision** counts texts that wait for a lead's decision, and **Your open tasks** counts your tasks.

If your session ends while you work, a login box opens with **Your session has ended. Please log in again.** Log in there. Your unsaved input is kept.

## Log out

What for: end your session, for example on a shared computer.

1. Open the user menu: the button with your name at the top right.
2. Click **Log out**.
3. If a dialog **Unsaved changes** opens, click **Save and log out**.
4. If a dialog **Unsaved profile changes** opens, click **Save and log out** to keep your changes, or **Discard and log out**.

## Find your way around

What for: know where things are.

The header is the same on every page:

- **Ontotator** on the left takes you to the start page.
- The breadcrumb shows where you are, for example **My tasks** or **Documents**.
- At the top right is the user menu: a button with your display name, your pseudonym and your roles. It holds **Profile**, **My technical reports**, **Technical problem…**, the **Theme** (**System**, **Light** or **Dark**) and **Log out**. Open it with a click, or with Enter or the arrow keys; Escape closes it. On a phone the button in the editor shows your initials.
- System administrators also see a gear next to it. It opens **Administration** (see [Administration](admin.md)). A number on the gear counts the open technical reports.
- **Handbook** in the header opens this handbook inside the app. On the Documents, consolidation and translation review screens, **Help** opens the handbook section about that screen; in the editor it is **More** > **Help for this screen**. On the project forms, a link next to the task profile opens the section that explains it. In the text card, **How to use it** next to *Newer set available* opens the section on new tool proposals. Click a screenshot in the handbook to open it at full size in a new tab.
- Below the chapter list, the handbook shows the app's version and commit, for example \`Ontotator 0.3.0 · commit cc65cea\`. Quote it when you report a problem.

![The user menu, open at the top right: Profile, My technical reports, Technical problem…, the theme choice and Log out](images/getting-started-user-menu.png)

The sidebar is for your work. It lists the project switcher, **My tasks** and **Projects**. The number after **My tasks** counts your open tasks, the same tasks as the **To do** tab; it updates as soon as you submit a text. Clicking **My tasks** or **Projects** loads your projects and the count again, so a project you were just added to shows up without reloading the page. Leads also see their project's pages (**Documents**, **Progress**, **Settings**, **Export**); the list **Translation reviews** opens from **Progress**. In the editor, the sidebar folds into **Sections**; click it to open it. The user menu and the gear stay at the top right there too.

## Report a technical problem

What for: tell the system administrators about an error message, a page that does not load, a crash, or give general feedback. For a problem with the text of a task, such as a cut-off or wrong text, use [Report a text problem](annotator.md#report-a-text-problem) instead.

1. Open the user menu at the top right and click **Technical problem…**. In the editor, you can also open **More** and choose **Report a technical problem…**. If a text cannot be displayed, the message *Something went wrong while displaying this text.* offers **Report a technical problem…** too, and so does *Something went wrong while displaying this page.* when another screen, such as My tasks or Documents, cannot be displayed.
2. Under **What happened?**, write what you did and what you saw.
3. Click **Send report**.
4. The dialog shows *Sent as TR-12.* (your reference). Quote it if you ask an administrator about your report. Click **See my reports** to open the list of your reports.

The report goes to the system administrators, not to your project lead. Your task is not paused.

Ontotator adds what the administrators need to find the cause: the app version, the task if you send it from one (its kind, the project and the text), the screen, your browser, the window size and the last error the app received. From the crash message it also adds the error. Open **Added automatically** to see it before you send.

The report stays inside Ontotator; nothing is sent by e-mail or elsewhere. Do not write patient details beyond what is needed to describe the problem.

### See your technical reports

What for: look up a report you sent and whether it was handled.

1. Open the user menu at the top right and click **My technical reports**. It opens your **Profile** at that section. From the report dialog, click **My reports** (before sending) or **See my reports** (after sending).
2. The table shows each report you sent, newest first: **Ref.** (for example *TR-12*), **Sent**, **What happened** (your text; open a long text to read all of it) and **Status**. If you sent 100 reports or more, the newest 100 are shown; click **Show older reports** below the table for the rest.

**Open** means the administrators have not handled the report yet; **Done** means an administrator marked it as handled. Only you and the system administrators see your reports. Administrators do not answer in Ontotator; if you need an answer, contact an administrator and quote the reference.

If you have typed text in the dialog, **My reports** does not close it: send or cancel the report first. The crash screens do not show these links.

## Switch project

What for: work in another project.

1. Click the project switcher in the sidebar. It shows **Project** and the current project name. The shortcut is \`Alt+P\`.
2. Type part of the name in **Find project**.
3. Click the project, or choose it with the arrow keys and press Enter.

**All projects** opens the **Projects** page. There you see each project with **Your roles** and **Your open tasks**; click **Open** to go to a project. System administrators also find **Project archives** there, to move a project to another server (see [Move a project to another server](admin.md#move-a-project-to-another-server)). They can also remove a project created by mistake in its **Settings** with **Delete project…**, as long as nobody has worked in it (see [Delete a project without work](admin.md#delete-a-project-without-work)).

## See your tasks

What for: find the texts you have to work on.

1. Click **My tasks** in the sidebar.
2. Choose a tab: **To do**, **Submitted** or **All**. The tab **Paused** appears only while one of your tasks is paused.
3. If you work in several projects, choose a project in **Filter my tasks by project**, or **All my tasks**.

**Last change** is when you last saved or submitted the task, or when the lead last changed it, for example by reopening it.

![My tasks with the status tabs and a table of tasks, each with its Text, Task, Status and an action button](images/getting-started-my-tasks.png)

The list is ordered by status: **Reopened** first, then **In progress**, **Open** and **Submitted**. Within a status the tasks are in the order in which the lead assigned them; texts the lead moved to the front come first. Work from the top unless the lead says otherwise. You cannot sort the list yourself.

Each row is one task. The **Task** column says what to do, for example **Annotation, from scratch**, **Annotation, from proposals**, **Consolidation** or **Translation review**. The **Status** column shows **Open**, **In progress**, **Submitted** or **Reopened**.

- **Reopened**: the lead reopened your submission. The lead's reason stands under the task, for example *Reopened by the lead on 17 Nov, 14:30: The onset in sentence 2 is missing.* (on a narrow screen under the badge). Without a reason, click the badge to read when it was reopened.
- A **Translation review** the lead asked for a second time shows the lead's reason under the task, for example *Second review requested by the lead on 17 Nov, 14:30: Check the dose in paragraph 2.* What the lead added to it later stands below it, for example *Added by the lead on 17 Nov, 16:05: Paragraph 3 as well.* The translation review and the consolidation show the lead's reason again when you open the task.
- *Answer from the lead* at a submitted **Translation review**: you submitted it as a **Query** and the lead decided. Open the task to read the decision and the answer ([Review a translation](annotator.md#review-a-translation)).
- A **Consolidation** task shows the lead's reason under the task, for example *Reason from the lead: Term and assertion differ*, if the lead gave one.
- **Paused**: the task waits for a decision on a problem report. A long reason is cut off here; the task shows all of it. **Answer to your report** means the lead has replied.
- **Paused by lead**: the lead paused the work on this text and gives the reason below the mark. You can open and read the task (**View paused task**), but not save it, until the lead releases the text ([A task paused by the lead](annotator.md#a-task-paused-by-the-lead)).
- **Waiting for translation review**: the lead assigned the annotation ahead, and the translation is still being reviewed. You cannot start yet; the **Action** column says **Opens once a translation is accepted**. Once it is accepted, the task shows **Start** by itself. A rejected review keeps the task waiting. If the review leads to a corrected version, the task opens on that version.
- **Waiting for the project lead**: the text of this task was corrected and the task cannot follow by itself. You cannot start it; the lead decides how it continues, and it may leave your list.

On a phone, each row has two parts: under **Task** the text, what to do and the status below each other, and beside it the **Action**. The reason of a **Paused** or **Reopened** task is written out in full under its badge, so there is no badge to tap. The project is shown under the text when the list mixes several projects; the dates **Assigned** and **Last change** are left out. Nothing needs to be swiped sideways.

If the project has guidelines, a link such as *Project guidelines v2* (or *Project guidelines 3.1 (v2)*) appears above the table. Read them before you start: they say what to mark and how.

If you see **No texts are assigned to you yet.**, wait until your lead assigns texts to you.

## Try it out in a practice project

What for: learn the work on invented texts before your first real task.

A practice project is private. Only you see it, your lead does not. It has short, invented letters in German, no real patients. You can start it without German in your Profile. Nothing you do there counts: it is not in any project list, count or export.

You get practice if you are an annotator or a translation reviewer in at least one project.

1. In **My tasks**, the card **New here? Try it out first** appears. Click **Try it out**.
2. Your practice tasks appear in their own group, marked **Practice**, above your real tasks:
   - **Annotate from scratch**: mark findings yourself.
   - **Annotate from proposals**: check a tool's proposals. One is right, one has a prefilled value, one needs **Edit & Replace**, and the tool missed one finding. **Discard copy** takes a copy back if you change your mind.
   - **Translation review**: the German translation has one error. Find and correct it. To edit the text, **Mark checked sentences** and **Show changes** must be off.
   - **Consolidation**, if you are also a consolidator: two virtual colleagues disagree. Decide. Nobody accepts the result afterwards.
3. Open a task with **Start**. Above the task you see **Nothing here counts. Invented texts only.**
4. The panel **Your practice** lists the steps of the task. A step ticks itself when you have really done it. **Next:** says what to do now. Each step has a **Help** link to its handbook section.
5. To stop, click **Leave practice**. You return to **My tasks**.

When all practice tasks are done, the group folds to **Practice complete**. Click **Delete** to remove the practice project.

Click **Not now** to hide the card for good. Practice stays in your [profile](#practice-in-your-profile).

If practice is not available, **Try it out** says why. For example, the server may have no suitable HPO release yet; ask your administrator.

## Open a task

What for: start or continue your work on a text.

1. In **My tasks**, find the row of the task.
2. Click the button in the **Action** column:
   - **Start** for a new task,
   - **Continue** for a task in progress or a reopened one,
   - **View** for a submitted task (read-only),
   - **View paused task** for a paused task (read-only).
3. The task opens. While it loads you see **Opening task…**. In a project that records working time, a timer starts in the toolbar ([Working time](annotator.md#working-time)).

A link to a task that still waits shows **Waiting for translation review** instead of the text. Nothing is lost; the task opens by itself once the review is accepted. A link to a task the lead has to decide on shows **Waiting for the project lead**.

To move to your next or previous task without going back, use **Previous text** and **Next text** in the toolbar (\`Alt+←\` and \`Alt+→\`), or pick one in **Select text**.

How to work inside the task: [Your first task, start to finish](first-task.md), the [annotator reference](annotator.md) and, for consolidations, the [consolidator chapter](consolidator.md).

If you see **Task not found or not yours**, the task was withdrawn or is assigned to someone else. Click **My tasks** to go back.

## Read the project guidelines

What for: check the annotation rules of the project.

1. Open a task.
2. Open **More** in the toolbar and choose the guidelines, for example *Guidelines v2*, or *Guidelines 3.1 (v2)* when your lead gave the version its own number: *3.1* is the version of the guideline document, *v2* counts the uploads in the app. *(new)* after it means the guidelines changed since you last read them. In a translation review or consolidation, the guidelines are a button in the header instead, with a **New** badge.
3. The guidelines open beside the text; in the editor they take the right column as a tab next to **Details** (see [The guidelines in the editor](annotator.md#the-guidelines-in-the-editor)). Click **All versions** to see older versions, or **Close** to hide them.

The first time you open a task in a project with guidelines, a notice asks you to read them. Click the read button in the notice, for example *Read guidelines v2*. The notice also says where you find them later: under **More** › *Guidelines* in the editor, or the guidelines button in the header of a translation review or consolidation.

The guidelines are your project's rules: what counts as a finding, how much text to mark, how to handle negation or family history. The handbook explains the app, not these rules. If the project has no guidelines or they do not answer your question, ask your lead.

## Edit your profile

What for: keep your name, languages and qualification up to date.

1. Open the user menu at the top right and click **Profile**.
2. Change **Display name**, **E-mail**, **Languages you can read**, **Qualification** or **ORCID**.
3. To be named in exports, tick **Name me (display name and ORCID) as a contributor in exports**.
4. Click **Save**. You see **Saved.**

Your **Username** and **Pseudonym** cannot be changed. Exports show your pseudonym, not your name, unless you tick the box in step 3.

Fill in **Qualification** if you do translation reviews: you cannot submit a translation review without it.

## Choose a light or dark theme

What for: read comfortably, for example in a dim room.

1. Open the user menu at the top right.
2. Under **Theme**, choose **System**, **Light** or **Dark**. The page changes at once; there is nothing to save. The menu stays open, so you can compare.

The same setting is on your **Profile** under **Appearance**.

**System** follows the light or dark setting of your device and changes with it. **Light** and **Dark** stay as chosen.

The choice is kept in this browser, for everyone who uses it, and also applies to the login page. On another computer or in another browser, choose again. The images in this handbook show the light theme.

## Practice in your profile

What for: start, continue or remove your practice project at any time.

1. Open the user menu at the top right and click **Profile**.
2. Go to **Practice**.
3. Without a practice project, click **Start practice**.
4. With a practice project, you see the progress, for example *1 of 4 tasks done*, and the date it will be deleted:
   - **Continue** opens **My tasks** with your practice tasks.
   - **Reset…** deletes the practice project and makes a fresh one with the same texts.
   - **Delete…** deletes the practice project.
5. Tick or clear **Show the card New here? on My tasks**.

A practice project is deleted after 30 days without activity. Every change in it moves the date. Deleting it removes only the practice project, never real work.

A practice project keeps the translations it started with. If your administrator uploads a newer translation file, **Reset…** makes a fresh practice project that uses it.

## Set your search preferences

What for: search ontology terms in your own languages too.

1. Open the user menu at the top right and click **Profile**.
2. Go to **Search preferences**.
3. Tick **Search translated names** to search the translated names of terms.
4. Choose your **Preferred search languages**.
5. Tick **Automatically include the document language** to also search in the language of the text you work on.
6. Click **Save search preferences**. You see **Search preferences saved.**

## Change your password

What for: replace your password with a new one.

1. Open the user menu at the top right and click **Profile**.
2. Go to **Change password**.
3. Enter your **Current password**.
4. Enter a **New password** with 12 to 256 characters. It must differ from your username.
5. Enter it again in **Repeat new password**.
6. Click **Change password**. You see **Password changed. Other sessions were logged out and your API tokens were revoked.**

A new password also revokes all your API tokens, the project tokens you created included: a script that used one needs a new token.

If you forgot your password, ask an administrator for a reset code and follow [Set your password with a setup or reset code](#set-your-password-with-a-setup-or-reset-code).

## Create an API token

What for: let a script or another program read or export your projects without your password.

1. Open the user menu at the top right and click **Profile**.
2. Go to **API tokens** and click **New token…**.
3. Enter a **Token name** that says what uses it.
4. Tick the scopes the program needs: **Read**, **Import**, **Export** or **Project administration**.
5. Set **Valid for (days)**: 1 to 365, 90 by default.
6. Click **Create token**. The dialog, titled with the name of the token (*New token “Laptop script”*), shows the token once. Click **Copy token** and store it, for example in your password manager.
7. Tick **I have stored the token**, then click **Close**. Until the box is ticked, the dialog cannot be closed, not with **Close** and not with the Escape key.

The program sends the token in the header \`Authorization: Bearer <token>\`. It acts as you: it can do only what its scopes allow and what you may do yourself. Annotation, review and translation review work always needs the browser, and a token cannot create other tokens. Every change made with a token is in the audit trail with the token's name.

An AI assistant that speaks MCP, such as Claude Desktop, can use a token too: the Ontotator MCP server lets it set up a project, follow progress and download exports for you. Installing and configuring it is described in the [MCP server guide](../../mcp/README.md). Prefer a project token with a short lifetime for it. The line *Also for the Ontotator MCP server (AI assistant): see the handbook.* under your tokens opens this section.

To stop a token, click **Revoke…** in its row, then **Revoke token**. Every program that uses it stops working at once. All your tokens are also revoked when you change your password, when an administrator issues you a reset code and when your account is deactivated. Losing a project role does not revoke a personal token, but the token at once loses what the role allowed: it can only ever do what you may do yourself right now.
`,m=`# Lead: change course in a running project

This chapter is for project leads whose project is already under way and must change direction: a better translation turns up, finished texts must be annotated again, or there are more texts than the team can finish. Each procedure says what Ontotator does today and where it stops. Back to the [lead overview](lead.md).

What stays fixed in every case:

- Texts cannot be deleted. A text you no longer want stays in the project; you take it out of the plan ([Narrow the scope](#narrow-the-scope)).
- A submission never changes. New work is a new round or a new submission; the earlier one stays in the history.
- A final result can be replaced with **Change final…** or withdrawn with **Withdraw final…** ([Withdraw a final result](lead-results.md#withdraw-a-final-result)). For many texts, **More actions** › **Change final…** on **Documents** moves the final results to the newest submissions, with **Undo** in the message that follows ([Accept or change the final result of several texts](lead-results.md#accept-or-change-the-final-result-of-several-texts)). While a text has a final result, its annotation mode cannot be changed.
- There is no pause button for texts. A task is paused only by a problem report ([Decide on a problem report](lead-results.md#decide-on-a-problem-report)).

## Use another translation of a text

What for: bring in a translation made elsewhere, for example by another machine translation system or a person, for a text that already has a translation in the project.

Before you start: decide whether the new text replaces the current translation or stands beside it.

- *Replace*: the new text becomes the next version of the translation, for example v2. Annotation moves on to it; the old version stays in the history.
- *Beside it*: the new text is a parallel translation of the same source in the same language. Each one is reviewed on its own. With **Annotate only after the translation review is accepted** on, annotation of the text waits until every translation of it is accepted.

### Replace the translation in the app

This works without building a bundle. You upload the new text at the version, or it is pasted into a translation review.

1. Open the text card and click **Translation**.
2. If the current version is accepted: at the version, click **Ask a reviewer to correct…**, choose the **Translation reviewer**, enter the **Reason for another review** (say where the new text comes from) and click **Ask the reviewer**. The reviewer replaces the text, writes the origin into the **Rationale** and submits **Accepted with corrections** ([Request a translation correction](lead-documents.md#request-a-translation-correction)). The corrected text becomes the next version and counts as accepted.
3. Or, if the current version is accepted, paste the new text yourself: at the version, click **Correct it myself…**. The dialog lists the annotation work that stays on the accepted version. Your corrected text becomes the next version and starts as a correction with review On, so it is reviewed again ([Correct a translation yourself](lead-results.md#correct-a-translation-yourself)).
4. If the current version was rejected or queried: click **Resolve…**, then **Correct the translation…**, paste the new text yourself and submit. The corrected text becomes the next version and counts as accepted. If the reviewer proposed the new text with a query, **Accept the reviewer’s text…** under **Resolve…** takes it without retyping ([Resolve a rejected or queried translation](lead-results.md#resolve-a-rejected-or-queried-translation)).
5. Or, whatever the state of the current version, upload the new text: at the newest version, click **Upload a corrected text…**, paste the text or choose a .txt file, say how the text was made (for a machine translation with its provider and model), check the changes and save. The text becomes the next version, a correction that starts as *Ready for review*; accept it with **Accept this version…** if it was reviewed outside Ontotator ([Upload a new version of a translation](lead-results.md#upload-a-new-version-of-a-translation)).

**Ask a reviewer to correct…** is offered only at an accepted version that is the newest of its translation, **Correct it myself…** at the newest accepted version (for a rejected or queried one it is **Correct the translation…** under **Resolve…**), and **Upload a corrected text…** at the newest version of every translation that has no open translation review. Only **Upload a corrected text…** has fields for the provider and model of the new text; in a translation review they can only be named in the **Rationale**. A typo, a missing space or a grammar slip needs none of these steps: **Fix typos…** at the newest version fixes it without a review and keeps the status of the text ([Fix a typo in a translation without a review](lead-results.md#fix-a-typo-in-a-translation-without-a-review)).

### Replace or add a translation by file

1. Build an Ontospan bundle with the new text, as described in [Corrections and parallel translations in a bundle](lead-documents.md#corrections-and-parallel-translations-in-a-bundle).
2. On **Documents**, click **Upload texts…**, choose the **Format** **Ontospan bundle**, choose the file and click **Check**.
3. In the preview, open **Texts in this upload** and choose **Corrections** (or **Translations**) under **Show** to check that each new text was recognised as you meant.
4. Import the upload.
5. Decide whether the new version is reviewed:
   - With **Translation review** on for the text, the row's next step is **Assign review…**. Assign a reviewer as usual ([Assign work for one text](lead-documents.md#assign-work-for-one-text)).
   - With it off, the row's next step is **Assign review or accept…** ([Accept a translation that was not reviewed](lead-results.md#accept-a-translation-that-was-not-reviewed)).
   - To accept only the new version without a review: open the text card, click **Translation** and, at the version, click **Accept this version…**, enter a **Reason** and click *Accept v2* ([Accept one translation version](lead-results.md#accept-one-translation-version)). Other translations of the text stay as they are.
   - Setting **Review** to **Off** in the **Translation** part instead accepts the newest version of every translation of the text, parallel translations included, not only the one you uploaded.
6. If someone is still annotating the old version, or a submission exists on it, the row shows **Handle text change…** or *Carry to v2…*. Decide as in [Handle a text change for open annotation work](lead-results.md#handle-a-text-change-for-open-annotation-work) and [Carry submitted work to a new text version](lead-results.md#carry-submitted-work-to-a-new-text-version).
7. If the text already has a final result, the row asks you to confirm it: [Review changes to a final result](lead-results.md#review-changes-to-a-final-result).

The checkbox **These translations were reviewed outside Ontotator — accept them as they are** in the upload applies only to texts new to the project. A correction of an existing text is accepted with step 5.

To drop a translation, it must first be rejected or queried in a review: the discard item is offered only under **Resolve…** ([Resolve a rejected or queried translation](lead-results.md#resolve-a-rejected-or-queried-translation)).

## Annotate texts again

What for: have texts annotated again, for example after a guideline change, with new tool proposals, or by more people.

Before you start: [publish the new guideline version](lead-settings.md#publish-the-first-or-a-new-guideline-version) if the rules changed.

### The same annotators revise their work

1. Open the text card and click **Annotation**.
2. In each person's row, click **Reopen…**, enter a **Reason (optional)** (for example what changed in the guidelines) and click **Reopen assignment**.
3. The task shows **Reopened** in their **My tasks**. They continue on their submitted work as it was: nothing is carried and nothing is marked **Check needed**.
4. When they submit again and the text already has a final result, the row's next step is **Confirm final result**. Choose the newer result or keep the old one ([Review changes to a final result](lead-results.md#review-changes-to-a-final-result)).

For many texts at once, select them and choose **More actions** › **Reopen…** in the selection bar ([Reopen or withdraw the tasks of several texts](lead-documents.md#reopen-or-withdraw-the-tasks-of-several-texts)). Texts with a final result are skipped.

Annotators can also do this themselves: **More** › **Work rounds** › **Continue from** starts a new round from their submission, where each carried finding must be checked again ([Start a new work round](annotator.md#start-a-new-work-round)). While you or a consolidator work on a consolidation of the text, they cannot: the dialog tells them *Your submission is being consolidated, so you cannot continue from it now. Ask your project lead.* Finish the consolidation or withdraw its task first. In a task from tool proposals the dialog also sends them to you; start the round for them with **Start a round…**. You can start such rounds for the submitted annotations of many texts: **More actions** › **Start a round…** › **Continue from the submission** ([Start a new round for several texts](lead-documents.md#start-a-new-round-for-several-texts)).

An empty start is possible only before the first submission (**Start empty round**). After a submission, a fresh start needs your agreement: the annotator [reports a text problem](annotator.md#report-a-text-problem) and you choose **Agree clean restart…** ([Decide on a problem report](lead-results.md#decide-on-a-problem-report)). The new round has none of the earlier findings; a task from scratch starts empty, a task from proposals starts again on the newest tool proposals of the text, all open. For submitted annotations you can restart without a report: **More actions** › **Start a round…** › **Restart**, with a reason.

### Work from new tool proposals

A proposal set you import later is used only by annotation rounds that start after the import, for example for a new assignment of a text planned **Annotate from proposals**. A task keeps the proposals its round started with, also after **Reopen…** or a new round from a submission. A restart starts it again on the newest proposals: **Restart** under **More actions** › **Start a round…** for submitted annotations, or a restart agreed on a problem report (**Agree clean restart…**).

The text card shows which set a text's tasks work on: **Annotation** names it, for example *Proposals set 2026-10-02 (phentrieve 1.4), 24 proposals*, and adds *Newer set available: 2026-11-10* once a newer set of the text is imported. The note stays until every task of the text works on the newest set; until then the line names the older set still in use, and a person who is already on the newest set, or will start on it, has *newest set* in their row. Tasks that started before Ontotator recorded sets show *set not recorded*. The card itself offers no restart button; select the text and use **More actions** › **Start a round…**.

1. Import the new proposals in an Ontospan bundle ([Upload texts](lead-documents.md#upload-texts)). Only sets of kind \`tool_output\`, made entirely by tools, can be imported.
2. For a text without assignments, assign it: it starts from the newest proposals.
3. For submitted annotations, of one text or many: select the texts and choose **More actions** › **Start a round…** › **Restart** ([Start a new round for several texts](lead-documents.md#start-a-new-round-for-several-texts)). Each task starts a new round on the newest proposals, all open.
4. For one task already under way, its annotator can [report a text problem](annotator.md#report-a-text-problem) and you choose **Agree clean restart…** ([Decide on a problem report](lead-results.md#decide-on-a-problem-report)). The task starts a new round on the newest proposals; the earlier rounds stay in the history. Other people's tasks on the text keep their proposals.
   Without a report, restart the task through the API or the MCP server: \`POST /api/v1/assignments/{id}/rounds\` with \`kind\` \`clean_restart\` and a \`reason\` (scope \`project-admin\`), or the MCP tool \`start_new_round\` with \`kind\` \`clean_restart\`, a \`reason\` and, after its dry run, \`confirm\`. The task ID is in the text card's **Details**. The current round and its draft are dropped; submitted work stays in the history. Afterwards the card names the newest set and *Newer set available* is gone once every task of the text is on it.
5. To restart the whole text instead: open the text card, click **Annotation** and click **Change mode…**. Enter the **Reason** and click **Discard work and change mode** (or **Change mode**). The text is now from scratch, and the work on the whole text is discarded, submitted work included; the assignments are removed ([Change the annotation mode of one text](lead-documents.md#change-the-annotation-mode-of-one-text)). Then choose **From proposals** under **Annotation** and assign the text again.
   To do this for many texts at once, select them and choose **More actions** › **Change mode…** ([Change the annotation mode of several texts](lead-documents.md#change-the-annotation-mode-of-several-texts)).

For a text with a final result this is not possible: **Change mode…** is refused with *A final result was chosen for this text, so its annotation mode stays.* (error code \`ANNOTATION_MODE_FINAL_SELECTED\`). Withdraw the final result first ([Withdraw a final result](lead-results.md#withdraw-a-final-result)), or, to annotate such a text again without discarding work, add annotators as in [More annotators on finished texts](#more-annotators-on-finished-texts).

### More annotators on finished texts

1. Raise the limit: **Settings**, tab **Workflow**, **Annotators per text** ([Set annotators per text and the consolidation rules](lead-settings.md#set-annotators-per-text-and-the-consolidation-rules)). For a few texts only, give them their own limit in the assign dialog instead: the info button (i), **Only for the selected text** ([Assign work for one text](lead-documents.md#assign-work-for-one-text)); the API and MCP do the same (\`PUT /api/v1/projects/{key}/texts/{case}/{language}/annotations-per-text\`, MCP \`set_annotations_per_text\`).
2. For texts without a final result, assign as usual: select them and click **Assign annotation…**.
3. Texts with a final result are left out of the assign dialog, for one text as for many: it says *This text is at another step of the plan.* Only the command line or the API add an annotator to such a text ([On the command line](#on-the-command-line)).
4. When their submissions arrive, the row asks you to confirm the final result. To use another result, click **Change final…** and **Use as final** ([Change a final result](lead-results.md#change-a-final-result)), or start a consolidation.

## Narrow the scope

What for: finish fewer texts than planned, for example when the work goes slower than hoped.

1. Select the texts to take out. Use **Select by case IDs…** with a list from a spreadsheet, or a filter and the checkbox in the table header ([Select texts](lead-documents.md#select-texts)). To keep a list of texts and take out all others, paste the list and tick **Select all except these**. One selection holds at most 2000 cases.
2. Click **Plan…** in the selection bar.
3. Under **Annotation**, choose **Off (not annotated)** for each language. Under **Translation review**, choose **Off** if the reviews should stop too.
4. Optional: enter a **Reason (optional)**, for example *Adults only in this study*. The final export names the texts you take out with this reason.
5. Read what will change. Open tasks are withdrawn; annotation drafts are kept. Final results of these texts stay in the history but are no longer exported.
6. Tick **I understand** (or **I understand — withdraw the open tasks**) and save again.

Texts with neither a translation review nor an annotation planned leave the main list. To see them, tick **Show texts not in plan** on the tab **All**. On **Export**, those that still have a final result are listed under **Not planned, not exported**; the others just leave the list. A line below the check counts the texts taken out of the work plan, for example *1 text taken out of the work plan is listed in planned-out.csv*. The final export names those texts with the plan revision, the time and the reason, in README.txt and planned-out.csv ([Export final results](lead-results.md#export-final-results)).

To take the change back, click **Undo** in the message. It restores the plan and the final results as they were, without asking you to confirm them again, but not the withdrawn tasks: the message then offers their texts, for example *Select the 2 texts with withdrawn tasks*; select them and assign them again. Planning a text again later, instead of Undo, asks you to confirm its earlier final result.

Other ways to make the work smaller:

- Fewer people per text: lower **Annotators per text**. Nobody is removed; texts that already have more annotators keep them. Lowered with **Change…** in the assign dialog, the limit says how many texts already have more. To list them, tick **More annotators than the limit** under **Flags** in **Filter** ([Filter the list](lead-documents.md#filter-the-list)). To take the extra open tasks back, select those texts and choose **More actions** › **Withdraw open tasks…** with **Only annotations above the limit of annotators per text** ([Reopen or withdraw the tasks of several texts](lead-documents.md#reopen-or-withdraw-the-tasks-of-several-texts)), or remove one person at a time with **Remove…** in the text card ([Remove, reassign or reopen an assignment](lead-documents.md#remove-reassign-or-reopen-an-assignment)).
- Order of work: **My tasks** lists a person's tasks by status, then in the order of assignment ([Assign work to the selected texts](lead-documents.md#assign-work-to-the-selected-texts)). To have urgent texts done first whose tasks are already assigned, select them and click **Move to front** ([Move texts to the front of the queue](lead-documents.md#move-texts-to-the-front-of-the-queue)).
- Stop work for a while without withdrawing it: select the texts and choose **More actions** › **Pause texts…**; **Release texts…** lets it go on ([Pause and release the work on texts](lead-documents.md#pause-and-release-the-work-on-texts)). Submitted work and final results stay as they are and are exported.

## On the command line

Whoever runs the server can do some of this on the command line ([Server operations](../operations.md#users-ontologies-and-projects)):

- \`ontotator admin import PROJECT FILE\` imports a bundle as **Upload texts…** does. \`--accept-translation EXTERNAL_ID:LANG:VERSION=REASON\` accepts exactly one translation version of the bundle, a correction included, as reviewed outside Ontotator; repeat it for more.
- \`ontotator admin assign PROJECT USER --document ID\` assigns an annotation of the text with that document ID (see **Technical details** in the text card's **Details**), also on a text with a final result, within **Annotators per text**. Repeat \`--document\` for more texts. It cannot assign translation reviews or consolidations.

There is no command to request a translation correction, to discard a translation or to change the annotation mode; use the app for these.
`,h=`# Lead: texts, work plans and progress

This chapter is for project leads. It covers the **Documents** page: uploading texts, the text card, planning and assigning work, and following progress. Back to the [lead overview](lead.md).

On **Documents**, each row is one text: one language version of a case. See [case, text and document](README.md#glossary).

## Upload texts

### Prepare files for upload

Ontotator takes two formats:

| Format | Use it for | What goes in |
| --- | --- | --- |
| **Plain text** (.txt, or a .zip of .txt files) | Texts in one language, without tool proposals. | One UTF-8 text file per text. The file name without \`.txt\` becomes the text's ID: letters, digits, dots, hyphens and underscores, up to 128 characters, starting with a letter or digit. Each name may occur once. All files of one upload get the same **Upload language**. |
| **Ontospan bundle** (.zip or .json) | Texts with translations and tool proposals. | A ZIP with \`manifest.json\` and one JSON file per text under \`documents/\`, or a single exchange file (.json). Each text file holds the text, its language and case ID, whether it is a translation, and the tool proposals for it. |

Example of a plain-text ZIP:

\`\`\`
texts.zip
  case-201.txt
  case-202.txt
\`\`\`

Example of an Ontospan bundle:

\`\`\`
bundle.zip
  manifest.json
  documents/
    case-201-de.json    (source text, with proposals)
    case-201-en.json    (translation of case-201)
\`\`\`

Ontospan bundles are written by the Ontospan tools that produce the translations and proposals. Ask whoever runs those tools for a bundle.

Only proposal sets of kind \`tool_output\`, whose every author is a tool, can be imported. A newly imported proposal set is used only by annotation rounds that start after the import; tasks keep the proposals their round started with. See [Work from new tool proposals](lead-change-course.md#work-from-new-tool-proposals).

A bundle fits a project only if its ontology ID, layer IDs, ontology release, branches, annotation scheme and values match the project's [task profile](lead-settings.md#task-profiles) and ontology settings. The built-in template *HPO phenotype* fits only bundles with ontology \`hp\`, layer \`hpo-layer\` and exactly the branch \`HP:0000118\`. See [What must match a bundle](lead-settings.md#what-must-match-a-bundle).

### Corrections and parallel translations in a bundle

A bundle can also bring a new version of a translation the project already has, or a second translation of the same source. Each text file names its version in \`document.variant\`:

| What you bring | \`document_id\` and \`language\` | \`variant\` | \`translation\` |
| --- | --- | --- | --- |
| A new version (correction) of a translation | The same as the translation it corrects | \`version\` one higher than the newest version, \`origin\`: \`correction\`, \`derived_from\`: the \`text_sha256\` of the version it corrects | Not allowed: the bundle is refused with \`translation_unexpected\`. The provider or model cannot be recorded. |
| A parallel translation of the same source | A new \`document_id\`, the same \`case_id\` and \`language\` | \`version\`: 1, \`origin\`: \`machine_translation\` or \`human_translation\`, \`derived_from\`: the \`text_sha256\` of the source text | The run that produced it: \`provider\`, optionally \`model\` and the automatic checks. |

From format 1.3, a new translation can carry \`translation.review\` with \`status\`: \`reviewed\` (and optionally \`reviewer\`, \`reviewed_at\` and \`note\`). Ontotator then accepts it at import as *marked as reviewed in the package*. A correction cannot carry it, as it has no \`translation\` part; accept it after the import ([Use another translation of a text](lead-change-course.md#use-another-translation-of-a-text)).

### Upload texts

What for: bring texts into the project, with or without tool proposals.

Before you start: [prepare the files](#prepare-files-for-upload). Check the [languages of the texts](lead-settings.md#set-the-languages-of-the-texts) and the [plan for new imports](lead-settings.md#choose-the-plan-for-new-imports).

1. Open **Documents** and click **Upload texts…**.
2. Choose the **Format**. For plain text, also choose the **Upload language**.
3. Click **Choose files…** and select your files.
4. Click **Check**. Nothing is imported yet; the dialog shows *Checking 2 files …*.
5. Read the preview: the number of cases, proposals and texts already in the project, and any **Notes**. **Texts in this upload** lists every text; under **Show**, choose for example **Corrections** to see only new versions of translations. For plain text, the first note shows which text ID each file name became. A note says what, if anything, you need to do; **Show** lists the texts and proposals it concerns.
6. Check the **Work plan** before you import: it decides which tasks the imported texts get. For each language, click a chip to turn the **Translation review** or the annotation on or off. Sources marked *only cases without a translation* are annotated only where a case has no translation. Click **Adjust per case…** for exceptions. The line next to the import button repeats the plan, for example *Work plan: translation review de; annotate de*.
7. Optional: if translations are not marked as reviewed and you want them annotated without review, tick **These translations were reviewed outside Ontotator — accept them as they are** and enter a **Reason**. This applies only to texts new to the project, not to a new version of a text already in it.
8. Click the import button, for example *Import 20 cases*.

![The Upload texts dialog after the check, with the summary and the work plan](images/lead-upload-preview.png)

What you may see:

| Message | Meaning |
| --- | --- |
| *…: problems found. Nothing can be imported.* | The dialog names the problems per file and, for a bundle that does not fit the project, what the bundle uses, what the project uses and who can change it. Click **Discard** (or **Cancel**): the upload is dropped and the dialog closes. Fix the files or the settings and upload again. |
| **You can close this dialog; the import continues, and the texts appear after the next page load.** | The import runs. Reload **Documents** later. |
| *Imported 20 documents and 35 proposals.* | The import is done. |
| **This upload failed. Nothing was imported.** | **Discard it and upload the files again.** |

If you chose **Plan nothing; I plan texts on Documents**, the new texts appear as *Not decided* until you plan them ([Plan several texts at once](#plan-several-texts-at-once)).

## The Documents page

The **Documents** page lists every text of the project and what it needs next. Open it with **Documents** in the sidebar. A number next to it counts the texts that need your decision.

![The Documents page. The row with a coloured edge needs your decision; its Next step button opens that decision.](images/lead-documents.png)

### Columns of the Documents table

| Column or mark | Meaning |
| --- | --- |
| **Text** | The case ID, the language, the text version and a **NEW** badge for texts that are new since your last visit. |
| **Translation**, **Annotation**, **Finalization** | The state of each stage, with the names of the people involved. Where the table has no room for them, a column shows a shorter state without the names; see [On a narrow screen](#on-a-narrow-screen). |
| Robot icon | The text has tool proposals. |
| **Waiting on** | Who the text waits for. **You** in bold means it waits for you. |
| **Next step** | A button for the next action on this text, for example **Assign annotation…**, **Accept result…** or, when submissions differ, **Compare results…**. Rows that need your decision also have a coloured left edge. |
| **Last activity** | When something last happened on the text. |

A task starts with the person's first saved change; opening it is not enough, and neither is ticking checked sentences in a translation review. Until then **Translation** and **Annotation** read *assigned, not started* with the person's name, in the table (*not started* without the name where the column is short of room), its tooltip, the narrow cards and the text card, where the person's row shows **Not started**. After the first save they read *in review* or *In progress*. The same holds for a task you reopened, also when you asked a reviewer who had already submitted to correct a translation: it reads *assigned, not started* again until the person saves a change after the reopen. With several people or parallel versions the cell counts them, for example *1 of 2 started*.

A text with fewer annotators than **Annotators per text** shows what its people are doing, not the free place. While someone has an open task, **Annotation** reads for example *assigned, not started · max 2* or *1 of 2 submitted · max 3* (short of room *0/1 · max 2*, *1/2 · max 3*: submitted of the people who hold the text, then the limit; the tooltip has the full state), counted out of the people who hold the text; **Waiting on** names the person, the text is under **In progress**, and **Next step** still offers **Assign annotation…** for another annotator. The same holds after **Start a round…** for a text with one annotator. Only a text nobody is working on reads *1 annotator · max 2* or *Unassigned* and is listed under **To assign** (or under **Needs your decision** once its one annotation is submitted). To give texts in progress another annotator, select them and click **Assign annotation…** in the selection bar: it assigns only where a text still has a free place. To list these texts, tick **Can take another annotator** under **Annotation** in **Filter**: it lists every text whose steps include **Assign annotation…**, also while its first annotator is at work. Combine it with the tab **In progress** to see only the texts that someone already works on. When **To assign** is empty, it says so (*No text waits for an assignment*) and offers **Show texts that can take another annotator**.

The counts in **Annotation**, for example *0 of 1 submitted*, count only work on the newest version of the text. After a text change, a submission on the old version no longer counts: neither when it was carried to the new version, nor when the new version was started fresh. Carried work counts once it is submitted on the new version.

### Use the Documents tabs

What for: work through texts by what they need.

1. On **Documents**, choose a tab: **Needs your decision**, **To assign**, **In progress**, **Done** or **All**.
2. Click **Refresh** to reload the table and the counts.

A tab keeps your filters and search. A text that leaves the tab while you work on it, for example one you just assigned under **To assign**, stays in the table with a *Changed: …* or *Resolved* badge, so the list does not jump. **Refresh** or another tab removes such texts.

### Do a text's next step

What for: act on a text directly from its row.

1. In the **Next step** column, click the row's button, for example **Assign annotation…**, **Accept result…** or **Decide on report…**.
2. The matching dialog, card or page opens. The tasks in this chapter and in [Lead: results, decisions and export](lead-results.md) describe each one.

If you have an open task on the text yourself, the row shows **Open my task** instead. It opens your task in the editor or on the consolidation screen.

### Search texts

What for: find a text by its ID. The search does not look at the words in the text.

1. Type into the search field **Case ID…**. Any part of the ID is enough, in upper or lower case: \`fr100994\` and \`100994\` both find \`FR100994\`. To find one language, add it: \`FR100994 fr\`.
2. The list updates after a short pause or when you press Enter.

The search stays inside the open tab. If it finds nothing there but finds texts under another tab, the list says so and offers a button to show them under **All**, with your search kept.

To clear the search, click ✕ in the field.

### Filter the list

What for: show only texts in a certain state, language or origin, or the texts of one person.

1. Click **Filter**.
2. To see what a person was given, choose them under **Assigned to**. The list shows their texts in every task, open and submitted; revoked assignments are left out.
3. Tick the options you need, for example under **Language**, **Translation review**, **Annotation** or **Final**. Each choice applies at once.
4. Under **Order**, choose **Case ID**, **Import order** or **Last activity**.

Active filters show as chips above the table. Remove one with its ✕, or click **Clear all**. Options without texts are hidden; click the button below the options, for example *Show 4 empty filters*, to see them.

To list the texts you paused, tick **Paused by lead** under **Flags** ([Pause and release the work on texts](#pause-and-release-the-work-on-texts)).

To find texts with spacing errors or invisible characters, tick **Typography hints** under **Flags** ([Find spacing errors and invisible characters](#find-spacing-errors-and-invisible-characters)).

To find texts with more annotators than **Annotators per text** allows, for example after you lowered the limit, tick **More annotators than the limit** under **Flags**. It counts the unremoved annotation tasks of a text's current version, open and submitted. A text with its own limit ([Assign work for one text](#assign-work-for-one-text)) is measured against that limit, not the project's. To withdraw the extra open tasks, select the texts and use [Withdraw open tasks…](#reopen-or-withdraw-the-tasks-of-several-texts).

### Sort and page through the table

- Click the column header **Text** to sort by case ID, up or down.
- Click **Last activity** to sort newest or oldest first.
- The other headers sort only the rows on the current page.
- Below the table, click **Next** or **Previous** to see more rows.

### On a narrow screen

The table fits the page from 1280 px width, without scrolling sideways, and each text keeps one line. It shows as much as fits: with room to spare every state has its names and **Waiting on** lists everyone. Where a column has no room, it gives up words in this order:

- **Paused by lead** and **Typography hints** in the **Text** column become a pause icon and a pilcrow (¶) icon. Point at the icon to read the full mark.
- The widest stage column, then the next, shows a shorter state and leaves out the names, which **Waiting on** already shows. For example *assigned, not started (Ana Weber)* reads *not started*, *1 of 2 submitted* reads *1/2 submitted*, *ready to compare* reads *to compare*, *Check changes, newer result* reads *Check changes* and *Final is on old text* reads *on old text*. Submitted work from proposals that waits for the new version's proposals reads *v1 work waits* (*v2 has no proposals yet*).
  A paused consolidation reads *paused* after the pause icon.
- **Waiting on** shows one name and *+n* for the others.
- **Text** keeps *source*, the version marker and **NEW** on the line and cuts a long case ID with *…*. Only if that is still too wide, a crowded **Text** cell puts its marks on a second line.
- Point at a cell to see the full state with the names in its tooltip. Screen readers read the full state.

Below 1280 px, where even the short form is wider than the page, the table scrolls sideways with the **Text** column kept at the left.

Below 700 px width, each case is a card with its texts. Click a stage status to see the latest activity and the actions for that stage. Click **Details** to open the full text card.

## The text card

The text card shows everything about one text and lets you act on it.

### Open the text card

1. Double-click a row, or focus the text name and press Enter.
2. The card shows the path **Translation**, **Annotation**, **Finalization**. Click a part to see it. The card opens on the part that needs work now, or on the part with your next step.

![The text card with its three parts. The Annotation part is open and lists the annotators.](images/lead-text-card.png)

In the card:

- **Open text** opens the [text view](#read-a-text-and-other-peoples-work-in-the-text-view).
- **Previous text** and **Next text** walk through the table (keys \`K\` and \`J\`).
- **Other languages** switches to another language of the same case. Below 700 px width it shares a line with **Open text**.
- Your steps stand where they act. An open problem report is a notice above the path with **Open** and **Decide on report…**. Other steps stand at the top of their part under *Next step*, for example **Resolve…** in **Translation** or **Carry to v2…** in **Annotation**. A part's other actions share its action row, for example **Open result**, **Change final…** and **Withdraw final…** in **Finalization**.
- Every person's remove action is **Remove…**. Its dialog says what happens: an unsubmitted annotation is removed with its draft; other work is revoked and stays in the history.
- In **Annotation**, a text with tool proposals names the proposal set its annotators work on, for example *Proposals set 2026-10-02 (phentrieve 1.4), 24 proposals*. When a newer set was imported for the text and a task still works on an older one, the line names the older set and *Newer set available: 2026-11-10* follows, with **How to use it** ([Work from new tool proposals](lead-change-course.md#work-from-new-tool-proposals)); it goes away once every task of the text is on the newest set. Tasks that started before sets were recorded show *set not recorded*. A person's row names the set only when it differs from the text's, for example *newest set*.
- When a text has more than one version (for example after a translation correction), each person's row in **Annotation** ends with the version their task or submission is on, for example *Submitted 22 Oct, 14 findings · assigned 15 Oct · v1* and *Assigned 18 Oct by you, from proposals · v2*; the row of a running consolidation in **Finalization** names it the same way. With parallel versions the row names the version chain too, for example *DeepL v2*. A text with one version shows no version in these rows. A translation reviewer's row always says *Review of v2*.
- The days in a person's row follow one rule, for *Submitted*, *assigned* and *Removed* alike: *today 14:02*, *yesterday*, the weekday within the last week (*Mon*), else the date (*22 Oct*). Hover over the assignment day for the full date. When two proposal sets were imported on the same day, the **Proposals** line names them with their time, for example *set 2026-11-17 09:12* and *Newer set available: 2026-11-17 13:40*.
- In **Finalization**, **Open consolidation** opens your own running consolidation as your task; a submitted one opens read-only.
- In **Finalization**, when submissions differ, the agreement line is followed by the findings that differ in detail; a term and its parent or child on the same passage are named as *Related terms: …* (see [Accept a result or compare results](lead-results.md#accept-a-result-or-compare-results)).
- ✕ or Esc closes the card.

### Read the history and details of a text

What for: see what happened to a text and its technical IDs.

1. In the text card footer, click **History** or **Details**. The view's name stands next to **Back** at the top of the card.
   - **History** lists all activity, newest first, each line with date and time. A change names who made it and, where one was given, the reason, for example:
     - *task of R. Roe (ann-0295) reopened by you, 17 Nov, 13:37: Guideline changed* (**Reopen…**, single or for several texts; an Undo adds *reopening of the task of R. Roe (ann-0295) undone by you, …*),
     - *Round 2 for Tom Reis (ann-0004) started by you, 17 Nov, 13:39: Second pass* (**Start a round…**),
     - *the result of Tom Reis (ann-0004) chosen by you, …*, *changed from the result of Tom Reis (ann-0004) to the result of R. Roe (ann-0295) by you, …* and, after an Undo, *change undone by you, the result of Tom Reis (ann-0004) is final again, …* (the final result; a consolidation reads *the consolidation by …*),
     - *typos fixed in v2 by you, 17 Nov, 17:24: Typo; Grammar* (**Fix typos…**), and *annotation of Tom Reis (ann-0004) moved to v2 by itself after the typo fix, 17 Nov, 17:24* for each submitted annotation that moved with it ([Fix a typo in a translation without a review](lead-results.md#fix-a-typo-in-a-translation-without-a-review)),
     - *query decided by you, the reviewer’s text taken, v1 → v2, 18 Nov, 10:12: Yes, as proposed.* or *query decided by you, v1 accepted as it is, …* (**Accept the reviewer’s text…** and **Answer and accept the version as it is…** under **Resolve…**; the text after the colon is your answer to the reviewer),
     - *withdrawn by you, 17 Nov, 14:02: Wrong text* (**Withdraw final…**), reassignments, and *mode changed by you, now annotated from scratch, …: reason*.
   - **Details** shows the **Plan**, the **Problem reports** and the **Technical details**. Each problem report shows its title, then who reported it, when, its state and the paused tasks, then **Open report**. In the **Technical details**, the lines **Submission ID** and **Round ID** name the person and the version, for example *Submission ID, ann-0004, v1*.
2. Click **Back** to return to the path.

### Read a text and other people's work in the text view

What for: read a text with other people's findings or the final result, and compare two of them side by side. Leads see other people's work; everyone else sees only their own. A consolidator who does not lead the project reads the submissions on the consolidation screen instead ([Read others' work in the text view](consolidator.md#read-others-work-in-the-text-view)).

1. Open the text view with **Open text** in the text card.
2. Choose the language and version in **Language and version**.
3. In **Show**, choose **Text only**, a proposal layer, someone's annotations or the result. Its findings are listed under **Findings**: beside the text, or below it on a phone, where the text keeps the full width. Each finding names its code, and so does each of its modifiers, for example *Modifiers: Severe · HP:0012828 · “schwere”*.
4. Optional: click **Compare** to open a second pane. Each pane has its own **Language and version** and **Show** directly above its text: **Current text** on the left, **Comparison text** on the right, so both texts start at the same height. Tick **Couple scrolling** to scroll both together. Click **Close comparison** to close it.
   - When both panes show texts of the same language, for example v1 and its correction v2, tick **Show changes** to see what changed. The older version strikes through the removed passages, the newer version underlines the added ones; the line above the texts counts them. The marks do not change the texts, the findings or **Couple scrolling**. A changed number of spaces is marked and counted too, for example a double space typed into the text or a removed space at the end. A change of line breaks only, or of the kind of space (a non-breaking space for a space), is not marked or counted. If the two texts have little in common, the line reads *The texts differ too much to show the changes* and nothing is marked.
   - When **Show** has someone's annotations that were carried from an earlier version of the text (after **Carry to v2…** or **Handle text change…**), tick **Show changes since** v1 above the text: changed passages get a dashed frame, added text is underlined, and a **−** marker shows the earlier wording of removed text. **Next ›** and **‹ Previous** step through the passages. The annotator sees the same marks in their task. Not offered while **Compare** is open, which has its own **Show changes**.
5. Optional: click **Submissions** to open the **Submission history**. Choose a row to show it, then click **Close**. Someone who does not lead the project sees their own submissions there and, as a consolidator, the submissions they consolidate as rows without a link; the **Text card** button is shown to leads only. Each finding names its author by pseudonym; leads always see them, also when the project hides annotator names from consolidators. Each submission names the guideline version it was made under, for example *Guidelines v2* or, with your own version of the guideline, *Guidelines 3.1 (v2) (current: 3.2 (v3))* ([Publish the first or a new guideline version](lead-settings.md#publish-the-first-or-a-new-guideline-version)).

**Open my task** goes to your own task on this text.

### Review the translation versions of a text

What for: see each version of a translation, its reviews and its origin.

1. Open the text card and click **Translation**.
2. The list shows each version with its origin and status, then one row per person who worked on it: the name, the task and the status. Older ones are under **Older versions**; with parallel versions they are grouped by version chain.
3. Click **View text** to read a version, or **Translation reviews** to see every review decision, each with the guideline version it was made under (*Guidelines v2*, or *Guidelines 3.1 (v2)* with your own version). In a reviewer's row, **Reopen…** lets them review the version again and **Remove…** removes their assignment. A review of a version you fixed typos in has no **Reopen…**: assign a review of the corrected version instead.
   The buttons that change the text of a version say who does the work, and a grey line under them says the difference in a few words, for example *Ask a reviewer: a reviewer corrects it in a new review. Correct it myself: you edit it here; it is reviewed again. Fix typos: spacing, typos, grammar; the status stays, no review. Upload: a text made elsewhere becomes the next version.* At an accepted version, **Ask a reviewer to correct…** gives the correction to a translation reviewer ([Request a translation correction](#request-a-translation-correction)). At the newest accepted version, **Correct it myself…** lets you correct it yourself ([Correct a translation yourself](lead-results.md#correct-a-translation-yourself)). At the newest version that is neither reviewed nor accepted, **Accept this version…** accepts exactly that version ([Accept one translation version](lead-results.md#accept-one-translation-version)). At the newest version of a translation, **Upload a corrected text…** brings in a text made elsewhere as the next version ([Upload a new version of a translation](lead-results.md#upload-a-new-version-of-a-translation)). **Fix typos…** at the newest version fixes spacing, typos or grammar without a review and keeps the status of the text; a version made this way says *Typo fix* under its name, with the lead and the reason ([Fix a typo in a translation without a review](lead-results.md#fix-a-typo-in-a-translation-without-a-review)).
4. Click **Compare with source** to compare the translation with the source text.

### Find spacing errors and invisible characters

What for: find texts with spacing errors or invisible characters, for example before you assign them.

Ontotator computes typography hints for a text when you ask for them. A hint names a rule and a position in the text. Hints are not stored and never block review, annotation or export; nothing is corrected automatically.

| Rule code | What it finds |
| --- | --- |
| \`DOUBLE_SPACE\` | Two or more spaces inside a line. |
| \`SPACE_BEFORE_PUNCTUATION\` | A space before \`,\` \`;\` \`:\` \`!\` \`?\` or \`.\` |
| \`MISSING_SPACE_AFTER_PUNCTUATION\` | Punctuation directly between two words, for example *Fieber,Husten*. Numbers, dates, times, abbreviations such as *z.B.* or *e.g.*, web addresses and ellipses are left alone. |
| \`TRAILING_WHITESPACE_LINE\` | Spaces or tabs at the end of a line. |
| \`TRAILING_WHITESPACE_TEXT\` | Spaces, tabs or more than one line break at the end of the text. A single final line break is no hint. |
| \`TAB\` | A tab. |
| \`ZERO_WIDTH_CHARACTER\` | A zero-width space or joiner, or a byte order mark. |
| \`SOFT_HYPHEN\` | A soft hyphen. |
| \`CONTROL_CHARACTER\` | Another control character. |
| \`DOUBLE_FULL_STOP\` | Two full stops in a row, for example *Fieber..* An ellipsis (*...* or *…*) is left alone. |

A non-breaking space is no hint, because it is often correct, for example between a number and its unit. **Show invisible characters** marks it all the same.

On **Documents**, a text whose newest version has hints carries the badge **Typography hints**; point at it to read how many. To list these texts, for example before you assign them, click **Filter** and tick **Typography hints** under **Flags**. The number next to it counts the texts. A text with several parallel translations counts the newest version of each.

A translation reviewer sees the hints of their text before they submit: the confirmation of **Submit review…** names them and shows the places ([Review a translation](annotator.md#review-a-translation)).

Documents does not show where in a text the hints are. Read the positions through the API or the MCP server (token scope \`read\`):

- One text version: \`GET /api/v1/projects/{key}/documents/{document_id}/typography-hints\`, or the MCP tool \`list_typography_hints\` with \`document_id\`. Each hint has \`rule\`, \`start\` and \`end\`; positions count Unicode code points, as the positions of findings do.
- The whole project: \`GET /api/v1/projects/{key}/typography-hints\`, or \`list_typography_hints\` without \`document_id\`. It returns the number of hints per rule for each text that has any, 100 texts per page (\`limit\` up to 200); pass \`next_after\` as \`after\` for the next page. Only the newest version of each text is counted unless you ask for \`versions=all\`.

You get hints for the texts you may read, as with the texts themselves. The MCP tool returns no text; a server started with \`ONTOTATOR_MCP_READ_CONTENT=1\` can add excerpts with \`include_text\` ([MCP server guide](../../mcp/README.md)).

To see the characters in a text, a reviewer ticks **Show invisible characters** in the translation review ([Show invisible characters](annotator.md#show-invisible-characters)). To fix them in a translation, correct it ([Request a translation correction](#request-a-translation-correction)).

### Request a translation correction

What for: have a translation corrected by a reviewer.

1. Open the text card and click **Translation**.
2. At the version, click **Ask a reviewer to correct…**. It is offered only at an accepted version; for a rejected or queried one, use **Resolve…** ([Resolve a rejected or queried translation](lead-results.md#resolve-a-rejected-or-queried-translation)).
3. Choose the **Translation reviewer** and enter the **Reason for another review**. The reviewer reads it under the task in **My tasks** and above **Decision** in the review (*Second review requested by the lead on …*), so say what to look at.
4. Click **Ask the reviewer**, then **Close**. Before that, **Cancel** closes the dialog without asking anyone.

If the reviewer submits **Accepted with corrections**, the corrected text becomes a new text version. While a lead is correcting the same version themselves, the request is refused with *A lead is correcting this version.* ([Correct a translation yourself](lead-results.md#correct-a-translation-yourself)).

#### Add to the reason of a correction request

What for: tell the reviewer more after you sent the request, for example a second place to look at.

1. Open the text card and click **Translation**. The reviewer's row under **Translation reviewers** shows the request: *Correction requested on 18 Nov, 09:00:* and the reason in quotes.
2. In that row, click **Add to the reason…**.
3. Enter the **Addition to the reason** and click **Add to the reason**.

The reason as you sent it stays as it is; it cannot be edited. Each addition is a line of its own below it, with the date and who added it, for example *Added by you on 18 Nov, 10:12: Paragraph 3 as well.* The reviewer reads it below the reason, in **My tasks** and in the review (*Added by the lead on …*). **History** has a line for the request and one for each addition. Only a project lead can add, and only while the review is open: after the reviewer submitted it, or after the task was removed, the addition is refused (*Nothing can be added to this reason any more.*).

## Work plans and assignments

The work plan says, for each text, whether it gets a translation review and whether and how it is annotated. Planned texts show up in the main list; the others are hidden. Then the tab **All** says how many of its texts the table holds, for example *246 of 307*.

### Add a text to the plan

What for: start work on a text that is not planned yet.

1. On **Documents**, tab **All**, tick **Show texts not in plan**. Unplanned texts appear muted.
2. In the text's row, click **Add to plan…**.
3. Choose **Translation review** **On** or **Off**.
4. Choose the annotation: **Off (not annotated)**, **Annotate from proposals** or **Annotate from scratch**.
5. Click **Save**. The message has an **Undo** button.

### Select texts

What for: plan or assign many texts at once.

1. Click a row to select it. Shift+click selects a range; Ctrl+click (macOS: Cmd+click) adds single rows.
2. To select every filtered text, tick the checkbox in the table header.
3. The selection bar at the bottom shows how many texts are selected and their next steps, for example *next steps: Assign annotation (en, es)*. Selected texts the filters hide are counted too, and the bar says so, for example *4 texts in 2 cases selected (2 source texts not shown)*.

To list only the selected texts, across all pages, click **Show selected**. The list then ignores the tab and the filters and shows the chip **Selected texts**. Click **Show selected** again or remove the chip to return to your filters and page; changing a filter or tab also ends it.

To start over, click **Clear selection**.

### Select texts by pasting case IDs

What for: select texts from a list you have elsewhere, for example a spreadsheet.

1. Click **Select by case IDs…**.
2. Paste the IDs into **Paste case IDs**, one per line or separated by commas.
3. Check how many were found. Click **Copy unknown IDs** to copy the ones that do not exist.
   Case IDs are case sensitive, and two cases can differ only in case. An exact ID always wins. An ID in another case, for example \`fr100907\`, finds \`Fr100907\` when that is the only case ID that fits; the dialog lists it under *Matched in another case*. When several case IDs fit and none exactly, the dialog selects none of them and says so, for example *fr100907 matches FR100907 and Fr100907; enter the exact ID.*
4. Optional: to select every other text instead, tick **Select all except these**. The dialog then selects the texts that match the current tab, filters and search, except the texts of the pasted cases, and says how many, for example *120 other texts in 60 cases match the current filters.* These are the texts the table shows: texts not in plan count only while **Show texts not in plan** is ticked. This takes at most 5000 case IDs.
5. Optional: to keep the current selection, tick **Add to the current selection instead**.
6. Click the select button, for example *Select 20* or *Select 120 other texts*.

A selection holds the texts of at most 2000 cases. With more, the dialog selects the first 2000 in list order and says *Selection is limited to 2000 cases.* Plan, assign or move one part, then select the next part. A plan save or an assignment also takes at most 2000 cases at once.

### Plan several texts at once

What for: set the work plan for a selection.

1. Select the texts, then click **Plan…** in the selection bar.
2. Optional: under **Quick choice for the selected translations**, pick **Translation review and annotation** or **Annotation only, no translation review**.
3. Or set it per language: **Translation review** and **Annotation**. **Leave as is** keeps the current plan.
4. Read what will change.
5. Optional: enter a **Reason (optional)**, for example *Adults only in this study*. It is kept with the change. When you take texts out of the plan, the final export names them with this reason. When you accept translations as reviewed outside Ontotator, the **Reason** is required and also recorded with the acceptance.
6. Click the save button, for example *Save for 20 cases*.
7. If work already exists, the dialog lists what happens to it. Tick **I understand** (or **I understand — withdraw the open tasks**) and save again.

![The Work plan dialog with the quick choice and one row per language](images/lead-work-plan.png)

**Undo** in the message restores the plan and the final results as they were, without asking you to confirm them again. It does not restore withdrawn tasks; withdrawn tasks keep their drafts. If the change withdrew tasks, the message after the Undo offers their texts, for example *Select the 2 texts with withdrawn tasks*. Click it to select them, then [assign the work](#assign-work-to-the-selected-texts) again. This works the same for the plan chips of one row. The offer stays until you close the message.

### Change the annotation mode of one text

What for: switch one text between from proposals, from scratch and not annotated.

1. Open the text card and click **Annotation**.
2. Under **Annotation**, choose **From proposals**, **From scratch** or **Off**. It saves at once.

Once someone is assigned, started or submitted work, a line *Fixed: …* says who fixes the mode:

- While the work is not submitted, remove the assignment ([Remove, reassign or reopen an assignment](#remove-reassign-or-reopen-an-assignment)), then choose.
- To change it anyway, click **Change mode…** next to the line. The dialog names whose work is affected. Enter the **Reason**, then click **Change mode**, or **Discard work and change mode** if submitted work is discarded. Their assignments are removed. Discarded work is kept, not deleted: it no longer counts for progress, consolidation, the final result or exports.
- The mode change always discards the work of the whole text, never of single people.
- Once a final result is chosen, the mode is locked: **Change mode…** is refused and the dialog says *A final result was chosen for this text, so its annotation mode stays.* The API and the MCP server refuse it with the error code \`ANNOTATION_MODE_FINAL_SELECTED\`. Withdraw the final result first ([Withdraw a final result](lead-results.md#withdraw-a-final-result)), then change the mode.
- **Restore…** in the text card brings the discarded work back while no new annotation has started.

**History** in the text card shows the change and its reason.

For many texts at once, see [Change the annotation mode of several texts](#change-the-annotation-mode-of-several-texts).

### Assign work to the selected texts

What for: give translation reviews or annotations to people.

1. Select the texts, then click the assign button in the selection bar, for example **Assign annotation…**.
2. Check what the selection needs. If it needs more than one task or language, the line **This selection needs** lists every step, one task in one language each, for example *Translation review de ✓ · Annotation de · Annotation en*. Steps you are through have a tick, a skipped step reads *(skipped)*, the current step is bold, and *Step 2 of 3* says where you are. Then check the **Task**. Annotation that waits for a review you skipped is no longer listed: it cannot start in this dialog.
3. In the table of people (**Person**, **Reads**, **Open tasks**), pick the reviewer, or tick everyone who should annotate. The task has one language: each ticked person gets every selected text in that language that still has a free place. *Administrator* marks a system administrator; leave them unticked unless they take part.
4. Read the summary below the table, for example *Ana Weber gets 3 translation reviews (de).*
5. Click the assign button, for example *Assign 20 tasks*.

![The assign dialog with members, their languages and open tasks](images/lead-assign.png)

Texts that already have a final result are left out, also when you assign one text: the dialog says *This text is at another step of the plan.* See [More annotators on finished texts](lead-change-course.md#more-annotators-on-finished-texts).

**Reads** shows the languages in each person's profile. If someone's profile lists languages but not one the task needs, the dialog asks again; click **Assign anyway** or **Back**. A person with no languages listed counts as unknown and gets no warning. Ontotator sends no e-mail; the work appears in each person's **My tasks**.

The order in which you assign is the order in which a person works. The dialog says so above the summary: *My tasks lists a person's tasks by status, then in the order of assignment. New tasks come after the tasks the person already has.* With several texts it adds *These texts are assigned in the order shown above.*

- **My tasks** lists **Reopened** tasks first, then **In progress**, **Open** and **Submitted**. Within a status the tasks are in the order of assignment, and after a submit the editor opens the next task in that order.
- Several texts assigned at once are assigned in the order of the **Documents** list when you open the dialog (**Order**: **Case ID**, **Import order** or **Last activity**; a descending order counts as ascending). The line **Texts** in the dialog names them in that order.
- To give a person a fixed order that is not an order of the list, assign the texts in blocks, first block first, or one by one.
- A task you give to someone else with **Reassign…** is a new task for that person and comes last. A reopened task moves to the **Reopened** tasks at the top and returns to its place when it is submitted again. A task that follows a corrected text, or that you continue on a new version with **Handle text change…**, keeps its place. Work you carry to a new version from a submission is a new task and comes last.
- The upload order of the texts plays no part. To have texts done first whose tasks are already assigned, see [Move texts to the front of the queue](#move-texts-to-the-front-of-the-queue).

With **Annotate only after the translation review is accepted** on, you can assign annotators to a text while its translation review is assigned or underway, so both steps are set up at once. The summary says *Still in translation review: the task opens once the review is accepted.* The annotator sees the task in **My tasks** as **Waiting for translation review** and cannot start it; it counts under **Open tasks**. When the review is accepted, the task opens with no further step from you. This also holds for **Distribute evenly…**. A text with no translation review under way still cannot get annotators: assign the review first. With parallel translations of one text, only the translation under review can get a waiting task; the others follow once every translation is accepted, and the dialog's summary says which were left out.

What happens to a waiting task:

- **Rejected** or **Query**: it keeps waiting. Decide on the text as usual.
- **Accepted with corrections**, a lead correction or an uploaded correction: the task moves to the new version and opens there once that version is accepted. A task from proposals waits on the old version: the annotator sees **Waiting for the project lead**, and once the new version is accepted the text shows **Handle text change…**. There you move the task to the new version, where the decisions on the proposals are carried and only changed passages need a check. If the new version has no proposals yet, moving is not available: wait for them (their automatic transfer may still be running) or import them, click **Retry**, then move the task. A paused task stays too, until you decide its report.
- A task on an uploaded correction that was then **Rejected** or **Query**, with the older version accepted afterwards: the text shows **Handle text change…**; **Withdraw** the task, then assign the accepted version.
- You remove the review: the task keeps waiting, and the text shows the next step for the review.
- You turn Review off and accept the translation: the task opens. You turn Annotate off or discard the version: the task is withdrawn, as any open task.

The dialog works through the whole selection, one task and language at a time: translation reviews first, then annotation. After the assign button it stays open on the next step, lists what is already assigned and says what comes next. An annotation that waits for its review is the next step once the review is assigned. To pass a step without assigning it, click **Skip this task**; to go to another step, choose it under **Task**. Click **Close** when you are done, or assign the last step.

The closing message appears once the table shows the new assignments. It names what is left unassigned, for example *Left unassigned: annotation of case-0102 en*, and offers those cases, for example *Select the 2 skipped cases*. The message stays until you close it.

### Reopen or withdraw the tasks of several texts

What for: let the annotators revise many texts at once, for example after a guideline change, or take open tasks back, for example the annotations above a lowered **Annotators per text**.

1. Select the texts, then click **More actions** in the selection bar.
2. Choose **Reopen…** for submitted tasks, or **Withdraw open tasks…** for tasks not submitted yet. An entry that does nothing for the selection stays in the menu, unavailable, and says why, for example *No submitted tasks in the selected texts.*
3. Under **Tasks**, tick which tasks: **Annotations** (ticked at first), **Translation reviews** or **Consolidations**.
4. For **Withdraw open tasks…**: by default only tasks nobody has started are withdrawn. Tick **Also withdraw started tasks** to include tasks in progress or reopened; their drafts are kept. Tick **Only annotations above the limit of annotators per text** to keep the limit's number of annotations per text (a text's own limit where it has one) and withdraw only the open ones above it. Submitted work stays first, then started work, then the earliest assigned.
5. Read the preview. It groups the tasks by what happens to them and names the people with their number of tasks, for example *Reopen 9 submitted tasks · Tom Reis 5, R. Roe 4*. Click **Show all** to list every text of a group. What stays as it is has its own group with the reason, for example:
   - *Skip 3 texts · final result chosen: use Change final… first*: texts with a final result are not reopened.
   - *Keep 2 open tasks · not submitted yet*: there is nothing to reopen yet.
   - *Keep 1 started task · work has begun: tick “Also withdraw started tasks”*: started tasks (unless ticked), tasks paused by a problem report, tasks on a text paused by a lead and lead corrections are not withdrawn; each has its own group.
6. Enter the **Reason**. For **Reopen…** it is required: the people see it in **My tasks**. For **Withdraw open tasks…** it is optional (**Reason (optional)**). It is kept in each text's history.
7. Click the button that names the work, for example *Reopen 14 tasks*. The dialog lists what happens. Tick **I understand** (or **I understand — withdraw the open tasks**) and click the button again.

Every listed task changes, or none: if the texts changed since the preview, the dialog says *The texts changed since the preview. Check the new preview.* and shows it. Each task is recorded in the audit trail as a single reopen or withdrawal would be, so the history of every text shows it.

**Undo** in the message, for example *Reopened 14 tasks in 12 texts.*, takes the change back: reopened tasks count as submitted again; withdrawn tasks come back with their drafts. Undo is for the lead who made the change, once, within an hour, and only while nothing changed on these texts since: nobody saved a draft, nobody was assigned, the plan, the final result and the text version are the same. Otherwise nothing is undone, and the message names the first text in the way and what changed on it, for example *Undo is not possible: 1 of 12 texts changed since (EN100022 en: a task was assigned, reopened, withdrawn or paused, or got a new round). Nothing was undone.* An Undo that is older than an hour or was already used says *Undo is no longer possible: the texts changed since.* Through the API and the MCP server the same Undo is \`POST /api/v1/projects/{key}/bulk-task-actions/undo\` with the \`undo.id\` of the applied action, and the MCP tool \`undo_reopen_or_withdraw\`; with \`preview: true\` (the tool's dry run) it lists the tasks that would come back and says what blocks it, with each text in the way and what changed on it (\`blocked_texts\`), and changes nothing.

A message never lies over a dialog you open after it. If you open the next dialog while the message is still showing, the message waits; when you close the dialog, it is back with its **Undo** and stays for its full time again. This holds for every message with **Undo**, also in the annotation view.

Tasks reopened on a text that a lead paused stay paused until the text is released; the dialog says how many ([Pause and release the work on texts](#pause-and-release-the-work-on-texts)).

The same menu holds **Accept agreeing results…** and **Change final…** for the final results of the selected texts: see [Accept or change the final result of several texts](lead-results.md#accept-or-change-the-final-result-of-several-texts). The message after **Change final…** has **Undo** as well: it brings the earlier final results back, for the lead who made the change, once, within an hour, and only while nothing changed on these texts since.

### Start a new round for several texts

What for: give submitted annotations a new work round, for many texts at once. Either the people continue from what they submitted, or they start again without their earlier findings, for example on tool proposals imported after they began ([Work from new tool proposals](lead-change-course.md#work-from-new-tool-proposals)). It also works for a single selected text.

1. Select the texts, then click **More actions** in the selection bar and choose **Start a round…**. When the selection has nothing to start a round for, the entry is unavailable and says why, for example *No submitted annotations in the selected texts.*
2. Under **New round**, choose how the round starts:
   - **Continue from the submission**: the new round starts with what the person submitted. They check it, change it and submit again.
   - **Restart**: the new round has none of the earlier findings. A task from scratch starts empty; a task from tool proposals starts again from the newest proposals, all open.
3. Read the preview. It names the people with their number of tasks, for example *Continue 7 submitted tasks in a new round · Tom Reis 5, R. Roe 2*; click **Show all** to list every text. Only submitted annotations on the current version of a text get a round. What stays as it is has its own group with the reason:
   - *Skip 1 text · final result chosen: use Withdraw final… first*: the final result rests on a submission ([Withdraw a final result](lead-results.md#withdraw-a-final-result)).
   - *Skip 1 text · a consolidation is open: finish or withdraw it first*: the consolidation works on the submissions. A round for one such task is refused in the same way, in the web interface, through the API and by the MCP tool \`start_new_round\` (error code \`CONSOLIDATION_OPEN\`). **Agree clean restart…** in a problem report still restarts such a task ([Decide on a problem report](lead-results.md#decide-on-a-problem-report)).
   - *Keep 2 open tasks · not submitted yet*: tasks that are assigned, in progress or reopened are not touched.
   - Also kept, each in its own group: a task paused by a problem report, a task on an earlier or discarded version, a task whose person can no longer take it, a task whose translation is not accepted yet and, for **Restart**, submitted work without a work round (older or imported work: use **Reopen…**).
4. Enter the reason. For **Restart** it is required (**Reason**); for **Continue from the submission** it is optional (**Reason (optional)**). It is recorded with each new round in the audit trail.
5. Click the button that names the work, for example *Start 7 rounds*. The dialog says what happens. Tick **I understand** (for a restart **I understand — restart without the earlier findings**) and click the button again.

What happens to the work:

- Each person gets the task back in **My tasks** and must submit again. The text waits on that person again (**Waiting on**), and in the text card the person's row names the round, for example *Round 2, started by you 17 Nov · assigned 3 Nov, from scratch*; **History** has the line with your reason. The earlier submission no longer counts as submitted; it stays in the history and each person still reads their earlier rounds in the task, under **More** › **Work rounds**.
- After **Restart** the submitted work is set aside: it is not carried into the new round.
- Every listed task gets its round, or none: if the texts changed since the preview, the dialog says *The texts changed since the preview. Check the new preview.* and shows it. Each round is recorded in the audit trail like a single new round.
- This action has no undo, and no action on a single text brings back a round that was replaced. To let people only correct a submission in place, use **Reopen…** instead.

### Change the annotation mode of several texts

What for: switch many texts that already have annotation work between from proposals and from scratch, for example when the tool proposals turn out unusable, or usable after all. For each text it does what **Change mode…** in the text card does ([Change the annotation mode of one text](#change-the-annotation-mode-of-one-text)): the annotation of the text starts again, and the work on it is discarded.

1. Select the texts, then click **More actions** in the selection bar and choose **Change mode…**. When no selected text can change its mode, the entry is unavailable and says why, for example *No annotation work on the selected texts yet: set the mode with Plan….*
2. Under **Annotate the texts**, choose **From scratch** or **From proposals**. Neither is chosen at first. Each option says how many of the selected texts it changes.
3. Read the preview. The first group names the texts that change and the work that goes, for example *Annotate 4 texts from proposals · discards 6 submissions, removes 2 unsubmitted tasks*; click **Show all** to list every text. Below it, a list names every person affected, for example *Tom Reis: 4 submissions are discarded.* and *R. Roe: 2 submissions are discarded; 1 unsubmitted assignment is removed.* Consolidations are named as such. Texts that keep their mode have their own group with the reason:
   - *Skip 1 text · final result chosen: use Withdraw final… first*: a final result rests on the work ([Withdraw a final result](lead-results.md#withdraw-a-final-result)).
   - *Skip 2 texts · no annotation work yet: set the mode with Plan…*: nothing fixes the mode of these texts; **Plan…** or the text card sets it directly.
   - *Skip 6 texts · already annotated from scratch*: the text is already annotated this way.
   - *Skip 1 text · no tool proposals for the text*: only a text with tool proposals can be annotated from proposals.
4. Enter the **Reason**. It is required and recorded with each text's change.
5. Click the button that names the work, for example *Change mode of 4 texts*. The dialog says what happens and lists the people again. Tick **I understand — discard the work and change the mode** (**I understand** when no submitted work is discarded) and click the button again.

What happens to the work:

- The mode change always discards the work of a whole text, never of single people: every submission on it (annotations and consolidations) is discarded and every assignment is removed, also those in progress. Drafts are kept. Discarded work is kept, not deleted: it no longer counts for progress, consolidation, the final result or exports.
- The texts have no annotators afterwards: assign them again ([Assign work to the selected texts](#assign-work-to-the-selected-texts)).
- Every listed text changes, or none: if the texts changed since the preview, the dialog says *The texts changed since the preview. Check the new preview.* and shows it. Each text is recorded like a single mode change, so **History** in its card shows the change and the reason.
- There is no undo for the whole action. **Restore…** in a text card brings the discarded work of that text back while no new annotation has started on it.

- Reopened translation reviews have no Undo: the review starts again from the current text of its version, and the earlier draft cannot be brought back. The dialog says so before you confirm. The submitted decision stays in the history.
- Undo is recorded as a change of its own. A person who has the task open may be asked to reload it.

### Pause and release the work on texts

What for: stop the work on some texts for a while without taking it away, for example while the source text is clarified with the clinic, and let it go on later.

What a pause does:

- The open tasks of the text stay with their people. In **My tasks** each is marked **Paused by lead** with your reason. The people can read the task, but not save or submit it: annotations, translation reviews and consolidations alike, on every version of the text.
- The text itself is paused. A task you assign later, reopen or give a new round is paused from the start, until you release the text.
- Submitted work and final results are untouched. They are compared, accepted and exported as before.
- A pause from a problem report is separate. Each is released on its own, and a task opens only when neither holds: deciding a report does not release your pause, and releasing the text does not close a report.

To pause:

1. Select the texts, then click **More actions** in the selection bar and choose **Pause texts…**. When every selected text is already paused, the entry is unavailable and says so.
2. Read the preview. It groups the texts by what happens, for example *Pause 2 texts with 3 open tasks · Tom Reis 2, R. Roe 1* and *Pause 2 texts without open tasks · tasks assigned later are paused from the start*; click **Show all** to list every text. Texts that are already paused have their own group, *Skip 1 text · already paused by a lead*.
3. Enter the **Reason**. It is required: the people see it in **My tasks** and in the task.
4. Click the button that names the work, for example *Pause 4 texts*. The dialog says what happens. Tick **I understand — pause the work on these texts** and click the button again.

A person who has the task open when you pause is told with the next thing they do there: a banner *Paused by lead: …* with your reason appears above the text. What they typed and had not saved yet stays in their editor until they leave it.

On **Documents**, a paused text carries the badge **Paused by lead**; point at it to read who paused it, when and why. Its open work is nobody's turn: **Waiting on** does not name the people, and the stage shows the pause sign. To list the paused texts, tick **Paused by lead** under **Flags** in **Filter**. The text card shows a notice **Paused by lead** with who, when and why, and each paused person's row says *Paused by lead*.

A text whose consolidation is open keeps it while paused. The row reads *consolidating · paused* with the pause icon under **Finalization** (short of room: *paused*) and its annotations stay *2 of 2 submitted*, because submitted work is not paused. In the text card, **Finalization** keeps the consolidator's row with *Paused by lead*, and **Consolidate…** is not offered: the open consolidation continues after the release. The same holds when the consolidator reported a problem and that report pauses the consolidation; the row then waits for you with **Decide on report…**. In **History**, the lines of a consolidation stand under **Finalization**.

To release:

1. Select the texts and choose **More actions** › **Release texts…**. Or click **Release…** in the notice of one text card; the message *Released 1 text.* follows there as well.
2. Read the preview, for example *Release 3 texts with 4 open tasks · Tom Reis 2, R. Roe 2*. A task that a problem report pauses as well is named in its own group, *1 task stays paused · paused by a problem report as well: decide the report under Problem reports*. Texts that are not paused are skipped.
3. A reason is optional (**Reason (optional)**). Click the button, for example *Release 4 texts*, tick **I understand** and click again.

Every listed text is paused or released, or none: if the texts changed since the preview, the dialog says *The texts changed since the preview. Check the new preview.* and shows it. Each text gets its own entry in the audit trail, with the reason. The text card's **History** keeps a line for each pause and each release under the tag **Text**, also after the release: *paused by you, 17 Nov, 17:24: The clinic is checking the source text* and *released by you, 17 Nov, 18:02*, with the reason of the release when you gave one. There is no **Undo** in the message: **Release texts…** is the way back from a pause, **Pause texts…** from a release, and neither changes any work.

The other actions on paused texts:

- **Assign…** works; the dialog says that the task starts paused.
- **Reopen…** and **Start a round…** work for submitted tasks; the dialog says how many of them are on paused texts and stay paused until you release the texts.
- **Withdraw open tasks…** keeps a paused task, *Keep 1 paused task · paused by a lead: release the text first*. **Remove…** in the text card removes a single one.
- **Change mode…**, **Accept agreeing results…** and **Change final…** work as on any other text.
- **Fix typos…** and **Upload a corrected text…** on a version of a paused text work: they are your own actions and change nobody's work in progress. The pause covers every version, so tasks that follow a correction to the new version are still paused there.
- Correcting a translation yourself is refused while your own earlier review of that version is open and the text is paused: release the text first.
- **Agree clean restart…** on a problem report is refused while the text is paused: release the text first.

### Move texts to the front of the queue

What for: have some texts done first, for example a batch uploaded later that is now urgent.

**My tasks** lists each person's tasks by status, then in the order of assignment ([Assign work to the selected texts](#assign-work-to-the-selected-texts)). To put texts first whose tasks are already assigned:

1. Select the texts, then click **Move to front** in the selection bar.
2. Read the confirmation **Move to the front of the queue**. It says *Tasks already assigned on the 2 selected texts come first in My tasks. Tasks you assign later follow the order of assignment.* Click the button that names the texts, for example *Move 2 texts to the front*. Or click **Cancel**, or press Escape, to keep the order.

The selected texts now come first, in their earlier order among themselves; the other texts follow in theirs. The message says how many texts moved, for example *2 texts moved to the front of the queue.* In **My tasks**, the tasks of these texts that are already assigned now come first within their status, for every person who has one, in the order of assignment among themselves; a later move goes in front of an earlier one. Tasks you assign afterwards follow the order of assignment. **Import order** under **Order** on **Documents** follows the new order of the texts. A later upload comes last again. Each move is recorded in the audit trail. There is no Undo: to change the order again, move other texts to the front.

### Assign work for one text

What for: assign a single review or annotation.

1. In the row, click **Assign review…** or **Assign annotation…**. In the text card, use **Assign review…** or **Assign annotators…**.
2. Tick the people. To annotate yourself without the Annotator role, click **Add me as annotator**.
3. Click the assign button, for example *Assign 2 people*.

With more than five people on a text, the line *Assigned:* names the first five and how many more there are, for example *and 3 more*; the list marks each of them *Already assigned*.

When every place of the text is taken, the other people turn grey with the reason, for example *no free place (1 per text)*. **Assign…** in the selection bar for a text whose places are all taken says the same, for example *Limit reached: 1 assigned, limit 1.*, and offers **Change…**. This is the limit of the text, not of the person. A text that already has more annotators than its limit says both numbers, for example *Limit reached: 10 assigned, limit 8.*

To change the limit of annotators per text from here, click **Change…** next to the limit and enter the number (1 or more; if the server has its own maximum, the field takes no more than that). A number you typed stays when you switch between the two choices below. If the button cannot act, the popover says why, for example *The project setting is already 1.*

- **Only for the selected text** (with several texts: **Only for the selected texts**) gives these texts their own limit, for example 4 annotators on one text for a method comparison in a project with 1. Click the button that names the number of texts, for example *Change for 1 text*. The text keeps its own value for every version, also a corrected one; the project setting and the other texts stay as they are. Entering the project's number again returns the text to the project setting. The popover then explains *Sets the most annotators for this text only (project: 1)*, and for a text that already has its own value its title reads, for example, *Up to 4 annotators for this text (project: 1)*.
- **For all texts** changes the project setting. Click **Change for all texts**. Texts with their own value keep it.

The text card then shows *Annotators: 4 for this text (project: 1)* in **Annotation**. Lowering the number removes nobody: annotators already assigned stay, and the popover says so, for example *This text already has more; its assignments stay.* Several selected texts change together or not at all. When the selected texts have different limits, the dialog says *limits differ*, lets you tick as many people as the text with the highest limit takes, and each text gets only as many as it has places; entering the project's number then returns every selected text to the project setting. The audit trail records a text's own value as *Annotators per text changed for one text*.

### Distribute work evenly

What for: spread a batch of texts evenly across people.

The proposal uses the languages in each person's profile: a person is proposed for a text only if they read its languages, or list no languages at all. People who list the text's languages come first; people with no languages listed only fill the places left over. Among them, fewest open tasks come first.

1. In the assign dialog, click **Distribute evenly…**. The proposal takes the place of the assign dialog; **Close** without confirming returns to it.
2. Set **People per text** and click **Propose**.
3. Check the proposal. The tasks are assigned in the order of the table, and each person sees theirs in that order in **My tasks**. Change a person in any cell, or click **Propose again**. Texts nobody can take are listed under **Texts nobody can take**.
4. Click **Confirm**. This covers only the task shown in the assign dialog. If the selection needs more, the assign dialog comes back on the next step; otherwise it closes and the message says the assignments are saved.

If you chose someone whose profile lists other languages than the text needs, the dialog stays open after **Confirm** and asks; click **Assign anyway**. The other rows are already saved.

If a text is still without anyone after you close the proposal, the assign dialog comes back on the same step and names it. Choose someone there, or **Close**: the closing message lists what is left unassigned.

### Remove, reassign or reopen an assignment

What for: change who works on a text, or let someone change a submitted annotation or translation review.

Warning: **Remove…** on an unsubmitted annotation in **Annotation** deletes the draft for good. Submitted work stays in the history. Removing a translation review, reassigning, or withdrawing a task through the plan keeps the draft.

A task that waits for the translation review shows **Waiting for review** in the person's row and can be reassigned or removed like any open task.

1. Open the text card and click **Annotation** (or **Translation** for reviews).
2. In the person's row, click one of these:
   - **Reassign…**: choose the **New assignee** and click **Reassign**. If work has started, confirm with **Reassign started work**. The new person starts from the document's inputs. The previous draft stays stored, but nobody can open it, its author included.
   - **Reopen…**: optional **Reason (optional)**, then **Reopen assignment**. For a submitted translation review (in **Translation**, or **Reopen** at the review in the text's versions), the same person reviews the newest version again, starting from its current text. To have a rejected or queried translation reviewed again by the same reviewer, reopen their review: assigning it to them again is not possible.
   - **Remove…**: confirm with **Remove** or **Confirm removal**.

Consolidations cannot be reassigned. Annotators can also continue from their own submission themselves ([Start a new work round](annotator.md#start-a-new-work-round)).

## Watch progress

What for: see the whole project at a glance.

1. In the sidebar, click **Progress**.
2. The first line counts cases, reviews and annotations. Click **need your decision** or **to assign** to jump to those texts.
3. The cards **Translation review**, **Annotation** and **Final result** count the texts per state. Each count opens **Documents** with the same texts.
4. The **People** table shows each person's open and submitted work; tasks that wait for a translation review count under **Waiting for review**, not as open. Click a name to see their texts.
5. In a project that records working time, **Working time** shows per task type the number of texts, the **Total active time** of everyone together and the **Median per text**, for example *2 min* or *1 h 05 min*. Active time includes the up to 3 minutes before each automatic pause. It names no person; single work periods are only in the research export ([Export research data](lead-results.md#export-research-data)).

![The Progress page with the stage cards and the People table](images/lead-progress.png)

Click **Refresh progress** to update. **Translation reviews** next to it opens the list of all translation reviews of the project, with reviewer, decision and rationale ([Read the translation reviews of a project](lead-results.md#read-the-translation-reviews-of-a-project)).
`,g=`# Lead: results, decisions and export

This chapter is for project leads. It covers choosing the final result of each text, consolidations, the decisions on translations, text changes and problem reports, and the export. Back to the [lead overview](lead.md).

## Accepting results and consolidation

Each text version gets one final result: one submission or one consolidation that you accept. Only final results go into the final export. You do this in the **Finalization** part of the [text card](lead-documents.md#the-text-card).

How to choose:

- If all submissions agree, accept one.
- If they differ in a few findings and one is clearly right, read them and use that one.
- If they differ and you want each difference decided on its own, start a consolidation.

### Accept a result or compare results

What for: choose the final result of a text.

1. On **Documents**, tab **Needs your decision**, click **Accept result…** or **Compare results…** in the row. The row reads **Accept result…** when there is one result to accept or the submissions agree in full, also on notes and modifier text spans, and **Compare results…** when they differ in anything. The card opens at **Finalization**.
2. With one submission or a submitted consolidation, check it and click **Accept result**. For a consolidation, the card says how its findings came about, for example *Consolidated by Carla Diaz · 32 matching, 1 decided by Carla, 2 groups left out*. Left-out groups are not in the result. If an annotator left findings **Unresolved**, the card lists them with who wrote each note. Accepting a submission directly keeps the flag and the note in the export; open the submission to check them first.
3. If all annotations agree, the card says so. Click **Accept result**. A finding an annotator left **Unresolved** never counts as agreed, so that text goes through the next step instead.
4. If they differ, the card shows the agreement, for example *Agreement: 5 of 9 findings match, 1 differs in context only*. When matching findings still differ in a note, a text span or a modifier text span, a line below names them, for example *Notes differ on 1 finding: Ataxia*. When people chose a term and its parent or child on the same passage, a line names the pair, for example *Related terms: Seizure / Status epilepticus*; it still counts as a difference. Findings an annotator left **Unresolved** count as differences and are listed with who wrote each note. **How is this counted?** explains the numbers. Open a submission with **Open submission** to read it in the read-only text view, where each finding and each modifier names its code. If that work was carried over from an earlier version of the text, tick **Show changes since** v1 above the text to see the changed passages ([See what changed since the earlier version](annotator.md#see-what-changed-since-the-earlier-version)).
5. Warning: the next action saves at once, without a confirmation. Click **Use as final** in the row of the submission you want (at phone width the submissions are listed one under the other, with their buttons below each). Or [start a consolidation](#start-a-consolidation) instead.

After saving, the card moves on to the next text that needs a decision. The decided row stays in the tab with a *Resolved* badge until you click **Refresh** or change the tab. To go back, [withdraw the final result](#withdraw-a-final-result) or [change it](#change-a-final-result).

![The Finalization part comparing two submissions, with the agreement line and Use as final](images/lead-compare-results.png)

If the project rule says the consolidator may not be an annotator, you cannot accept your own result; another lead must do it.

### Accept early while other annotations are open

What for: accept a result before everyone has submitted.

1. Open the text card at **Finalization**. It lists the annotations still open.
2. Optional: remove open work with **Remove…** in the warning.
3. Choose the result as in [Accept a result or compare results](#accept-a-result-or-compare-results).

Open work stays assigned unless you remove it.

### Start a consolidation

What for: let one person decide the differences between submissions and build one result.

Before you start: the text needs at least two submissions. The consolidator must have the **Consolidator** role in the project ([Change a member's roles](lead-settings.md#change-a-members-roles)), or be you.

1. In the text card, open **Finalization** and click **Consolidate…**. The form **Consolidate submitted results** opens with the compared submissions already ticked.
2. Under **Submissions to merge**, check the ticked submissions (at least two).
3. Under **Consolidator**, choose a person. The list starts with **Choose a consolidator**, then you (*You (Mia Lead)*), then every member with the Consolidator role; the hint under the list links **Settings → People**, where you give the role to someone who is missing. If the project rule forbids it, people who annotated this text are shown but cannot be chosen (*— Ana Weber annotated this text*).
4. If the person's profile lists languages but not the text's language, tick the box *Assign this consolidator despite missing en in their profile*, right under the list.
5. Optional: enter **Consolidation reason (optional)**. The consolidator sees it in **My tasks** and above the groups; it is also kept in the history.
6. Click **Start consolidation**.

If the button stays inactive, the form says why: *Select at least two submissions.*, *Choose a consolidator.*, *Confirm the consolidator despite missing en.*, or someone already has a consolidation in progress on this text. If that is you, the button reads **Continue consolidation**.

After the start:

- If you chose someone else: Ontotator sends no e-mail. Tell the person that a consolidation is waiting in their **My tasks**.
- If you chose yourself: you get the Consolidator role for this project. Click **Open consolidation** in the text card or **Open my task** in the text's row on **Documents**. Each opens your task, where you decide and submit.

While the consolidation runs, the card shows the consolidator and how many groups are still open. When the text has more than one version, the consolidator's row also names the version the consolidation runs on, for example *2 of 5 groups open · assigned 18 Oct by you · v1*. What the consolidator does is in the [consolidator chapter](consolidator.md). A consolidator who does not lead the project reads the submissions on the consolidation screen; the text view shows them their own results only, and its **Submissions** list names the submissions they consolidate without a link.

### Read a submitted consolidation

What for: see how a consolidation result came about before you accept it.

1. In the text card, click **Open consolidation**. Or, if the card shows flagged findings ("guidelines unclear"), click **Open** next to one to go straight to that group.
2. The heading reads, for example, *Consolidation of CASE-1 en v1*. The banner says who submitted it. The view is read-only.
3. In decided groups, the chosen value of each conflicting row is tagged **kept**, including the chosen passage and modifiers. The consolidator's notes show as *Note: …*, in the list under each closed group as well, and flagged groups show **Flagged: guidelines unclear**. Added findings say who added them and list their values.
4. Click **Back to documents**.

### Accept a consolidation

What for: make a submitted consolidation the final result.

1. Click **Accept result…** in the row.
2. Read the consolidation first ([Read a submitted consolidation](#read-a-submitted-consolidation)). Pay attention to groups flagged **Flagged: guidelines unclear** and to the notes: they show where your guidelines need a clearer rule ([Publish the first or a new guideline version](lead-settings.md#publish-the-first-or-a-new-guideline-version)).
3. Click **Accept result**.

A submitted consolidation cannot be reopened or reassigned. If it contains a mistake, choose **Choose another result…** in **Finalization**, then **Consolidate…** to start a new consolidation; the earlier consolidation can be one of its submissions.

### Review changes to a final result

What for: confirm a final result after something changed, for example a newer submission or a corrected text. The row's next step is **Confirm final result**. Its **Finalization** cell says what changed, for example *Check changes, newer result*; *ready to accept* is a text that has no final result yet.

1. In the row, click **Review changes…**. The card lists what changed.
2. Optional: if the text changed, click **Show changes** to see the changed passages.
3. Choose one:
   - Keep the final result: **Keep the current final result**. If the text has several versions, the button names the version of the final result, for example *Keep final on v1*.
   - **Use the newer result**. If annotators marked findings in it **Unresolved**, the block lists them with who wrote each note.
   - Carry it to the new version, for example *Carry to v2…* (see [Carry submitted work to a new text version](#carry-submitted-work-to-a-new-text-version)).

### Change a final result

What for: pick another result after you already chose one.

1. Open the text card at **Finalization**.
2. Click **Change final…** next to **Open result**.
3. Click **Use as final** in the row of the result you want. It saves at once; the card stays on this text and says *Final result saved for EN100022 en.* Each result names the guideline version it was made under, for example *Guidelines v2 (current: v3)*, or *Guidelines 3.1 (v2) (current: 3.2 (v3))* when the versions have your own numbers ([Publish the first or a new guideline version](lead-settings.md#publish-the-first-or-a-new-guideline-version)).

The message *Final result of EN100022 en changed.* has an **Undo** button, also while the card is open. It brings the earlier final result back (*The earlier final result of EN100022 en is back.*), under the same rules as the Undo of **Change final…** for several texts: for the lead who made the change, once, within an hour, and refused once something the final result rests on changed since ([Accept or change the final result of several texts](#accept-or-change-the-final-result-of-several-texts)). The same message follows **Use the newer result** under *Review changes…*. After the Undo, the green line *Final result saved for EN100022 en.* in the card goes: it spoke of the result that is no longer final. A first choice of a final result has no Undo: use [Withdraw a final result](#withdraw-a-final-result). **History** in the card lists each change and its Undo.

While a text has a final result, its annotation mode cannot be changed: **Change mode…** is refused (error code \`ANNOTATION_MODE_FINAL_SELECTED\`) ([Change the annotation mode of one text](lead-documents.md#change-the-annotation-mode-of-one-text)). To take the final result back instead, see [Withdraw a final result](#withdraw-a-final-result).

### Withdraw a final result

What for: take a final result back, for example before finished texts are annotated again.

1. Open the text card at **Finalization**.
2. Click **Withdraw final…** next to **Change final…**.
3. Read what happens: the text has no final result until you choose one again; final exports already made stay as they are; **Change mode…** is possible again; submissions and consolidation stay.
4. Enter the **Reason**, tick **I understand** and click **Withdraw final result**.

The text asks for a final result again, and its submitted annotations can get a new work round again: **More actions** › **Start a round…** skips texts with a final result ([Start a new round for several texts](lead-documents.md#start-a-new-round-for-several-texts)), and so does **More actions** › **Change mode…** ([Change the annotation mode of several texts](lead-documents.md#change-the-annotation-mode-of-several-texts)). **History** in the text card shows the withdrawal with your reason. If someone changed the final result meanwhile, nothing is withdrawn: the dialog says *This final result changed. Nothing was withdrawn.* and loads the current one. Check it, then tick **I understand** again to withdraw it, or click **Cancel**.

### Accept or change the final result of several texts

What for: settle many texts at once on **Documents**: accept every selected text whose annotations agree, or move final results to newer submissions after a second round, a reopened annotation or a consolidation.

1. On **Documents**, select the texts, then click **More actions** in the selection bar.
2. Choose one. An entry that does nothing for the selection stays in the menu, unavailable, and says why, for example *No selected text has a newer submission than its final result.*
   - **Accept agreeing results…** is for texts without a final result. A text gets one when at least two annotations are submitted, nothing else is open on it and all findings agree in full, also on notes and modifier text spans. It never replaces a final result.
   - **Change final…** is for texts that have a final result. The newest submission of the text on the current version replaces the final result when it was submitted after the final result was chosen and is a consolidation, the text's only submission, or an annotation that agrees in full with the text's other submissions (as for **Accept agreeing results…**). A submission that was already there when a lead chose the final result does not replace it, and submissions that differ are never chosen for you.
3. Read the preview. It groups the texts by what happens to them; click **Show all** to list every text of a group.
   - **Accept agreeing results…**: *Accept the result of 38 texts · all annotations agree in full*; the texts left out, each group with its reason, for example *Skip 3 texts · the results differ: consolidate or choose in the text card*; and *Keep 12 final results · already final: use Change final… for them*.
   - **Change final…**: *Use the newest consolidation for 5 texts · Carla Diaz 5* and *Use the newest annotation for 3 texts · Tom Reis 2, R. Roe 1* name whose submission becomes final. Texts are skipped when they have no final result yet, other work on them is still open, nothing is submitted on the current version, the final result already is the newest submission, nothing was submitted since the final result was chosen, the newest submission is your own and the project rule says another lead must choose it, or the submissions differ (*Skip 2 texts · submissions differ: compare or consolidate first*).
4. Click the button that names the work, for example *Change 8 final results*. The dialog lists what happens. Tick **I understand** and click the button again.

Every listed text changes, or none: if a text or a final result changed since the preview, the dialog says *The texts changed since the preview. Check the new preview.* and shows it. Each text is recorded like a single **Accept result** or **Change final…**, so its **History** shows it.

- For texts skipped because the submissions differ, open the text card and compare them, or [start a consolidation](#start-a-consolidation); a submitted consolidation is then the newest submission.
- Warnings you acknowledged for the earlier final result do not carry over to the new one. Final exports already made stay as they are.
- **Change final…** can be undone: the message, for example *Changed the final result of 8 texts.*, has an **Undo** button. It brings back the earlier final result of every text, with the lead who had chosen it, the time of that choice and the warnings that lead had acknowledged; the message then reads *The earlier final results of 8 texts are back.* and the change is offered again. Undo is for the lead who made the change, once, within an hour, and it restores every text or none. It is refused when a text changed since: its final result was changed, confirmed again or withdrawn; a version of the text was added, discarded or restored; its work plan changed; a task of the text was assigned, reopened, withdrawn or paused, or got a new round (a decision on a problem report that pauses or restarts a task counts); or something was submitted. The message names the first such text and why, for example *Undo is not possible: 1 of 8 texts changed since (EN100023 en: its final result was changed, confirmed again or withdrawn). Nothing was undone.* Then use **Change final…** in the text card ([Change a final result](#change-a-final-result)).
- A final export made between the change and its Undo does not stop the Undo. It stays as it is and holds the changed results; the message says so, for example *The earlier final results of 8 texts are back. 1 final export made meanwhile stays as it is, with the changed results.* Export again to get the earlier results. Agreement numbers are not stored: a later export computes them from the restored final results.
- Undo is recorded as a change of its own: each text gets a new entry in the audit trail, and its final result a new revision.
- **Accept agreeing results…** has no undo. To go back, use **Withdraw final…** or **Change final…** in the text card ([Withdraw a final result](#withdraw-a-final-result), [Change a final result](#change-a-final-result)).

## Translation and text-change decisions

### Read the translation reviews of a project

What for: judge one reviewer's work, and read what reviewers wrote, without opening every text card.

1. In the sidebar, click **Progress**, then **Translation reviews**.
2. The list has one row per submitted translation review, newest first, and one per review that is assigned but not submitted (*Open*, always last). Each row shows the text (case ID, language, version), the reviewer, the decision, whether the change is clinically relevant, the categories, the rationale, the number of changed passages and when it was submitted.
3. Filter with **Person**, **Decision** and **Language**; **Order** turns the list to **Oldest first**. The address keeps the filters, so the list is as you left it when you come back from a text. The list shows 25 reviews per page; **Previous** and **Next** change the page.
4. Click **Compare versions** in the row of a review that was accepted with corrections. The text view opens with the reviewed version on the left and the corrected version on the right; tick **Show changes** to see the passages ([Read a text and other people's work in the text view](lead-documents.md#read-a-text-and-other-peoples-work-in-the-text-view)). Every other row has **Open text**, which opens the reviewed version: a query or a rejection creates no version, and an unchanged text has nothing to compare.

Read the **Rationale** column also for accepted reviews. A reviewer who accepts a translation may note a problem there that does not change the translation, for example an odd dose that the source also has. No other page shows such a remark.

The **Changes** column counts each changed place once, by words: a replaced wording is one passage. **Show changes** counts added and removed passages separately, so its numbers can be higher. A change of spaces or line breaks only is not counted. *Not counted* means the two texts differ too much to count.

Only leads and system administrators can open the list. To decide a query or a rejection, go on with the next section.

### Resolve a rejected or queried translation

What for: decide what happens after a reviewer rejected or queried a translation. The row's next step is **Resolve rejected translation** or **Resolve queried translation**.

1. In the row, click **Resolve…**. The options open below the row with the reviewer's rationale. When someone holds an annotation that waits for this translation, a line names them, for example *Ana Weber is waiting for this decision to start the annotation.*
2. For a query, decide it yourself with one of the first two items. Each closes the query as your decision, and the reviewer reads your answer at their submitted task (**My tasks**, *Answer from the lead*):
   - **Accept the reviewer’s text…**: the dialog shows the reviewer's question and, under **Reviewer’s text**, the text they proposed; you can still change it. Below it the changes against the version are marked, for example *Changes to v1 · 2 passages changed*, with added words underlined and removed words struck through. **Answer to the reviewer** is optional here. Click the button that names the new version, for example *Accept as v2*: the text becomes the next version, a correction of the queried one, and is accepted. If people annotated the queried version, the dialog says so before you save, as in [Correct a translation yourself](#correct-a-translation-yourself).
   - **Answer and accept the version as it is…**: the translation is right and the reviewer asked about something else, for example the source. Write the **Answer to the reviewer** (required) and click the button that names the version, for example *Accept v1*: the version is accepted without changes. A text the reviewer proposed is not taken.
3. Or choose one of the other items:
   - The reopen item, for example *Reopen Ana Weber's review…*: the same person reviews it again. Enter an optional **Reason (optional)** and click **Reopen review**. Their task shows **Reopened** with your reason (in **My tasks** behind the badge, in the review above **Decision**) and starts from the version's current text; their earlier decision stays in the history. If they then accept it with corrections, the corrected text becomes the next version.
   - **Assign a new review…**: someone else reviews it. The person who already reviewed it shows *Review submitted* with **Reopen their review…**; a new assignment for them is not possible, reopen their review instead. After **Fix typos…** on the rejected or queried version the review is a review of the corrected version, there is no reopen item, and the person who reviewed the earlier version can be assigned again ([Fix a typo in a translation without a review](#fix-a-typo-in-a-translation-without-a-review)).
   - **Correct the translation…**: you correct it yourself ([Correct a translation yourself](#correct-a-translation-yourself)). The correction starts from the text of the version, not from a text the reviewer proposed with a query; to start from the reviewer's text, use **Accept the reviewer’s text…**.
   - The discard item, for example *Discard the de translation…*: enter a **Reason** and click **Discard**. Nothing is deleted; the versions are marked as discarded.
4. Or click **Cancel**. Changing a filter, the tab, the order or the page also closes the options; nothing is saved until you choose.

After a decided query the row goes on with the accepted version, for example **Assign annotation…**, and people who waited for the decision can start. The version row names the decision, for example *Accepted: decision on the query of Ana Weber (ann-0003), the reviewer’s text taken, Project lead (ann-0002), 18 Nov, 10:12 · Answer: Yes, as proposed.* (*the version kept as it is* after **Answer and accept the version as it is…**; *taken with changes* when you changed the reviewer's text). **History** has a line for it, for example *query decided by you, the reviewer’s text taken, v1 → v2, 18 Nov, 10:12: Yes, as proposed.*, and the audit log records the decision with the answer. The decision is refused, and the dialog says so, while a translation review of the version is open, when a newer version exists, when the translation was discarded and when the query was already decided. After **Fix typos…** on a queried version you decide the query at the fixed version: its text is compared with the reviewer's text.

### Correct a translation yourself

What for: fix a queried, rejected or accepted translation without assigning another review.

1. For a queried or rejected translation: in the row, click **Resolve…**, then **Correct the translation…** (or **Continue your correction**). For an accepted translation: open the text card, click **Translation** and, at the newest accepted version, click **Correct it myself…**.
2. Read the panel: you review the version yourself, and your corrected text becomes the next text version. After a rejection or a query, it counts as accepted. A correction of an accepted version starts as a correction with review On: it is reviewed again before annotation moves to it. If people annotated the accepted version, the dialog says so before you start, for example *Annotation has work on v1. 3 annotations (2 submitted, 1 open) stay on v1. After saving, the row offers Handle text change…*. The dialog also names open consolidations and a final result on that version; they stay on it too. Nothing is carried automatically. If the reviewer rejects or queries your corrected version and you correct it once more, that next version is reviewed again as well; to take it without a review, use **Accept this version…** ([Accept one translation version](#accept-one-translation-version)). If your profile lists languages but not this one, tick *Correct despite missing de in your profile*. Without a qualification in your profile, the panel links to **Add your qualification in your profile**; after saving, **Back to Documents** returns you to the texts.
3. Click **Open translation review**. The screen says **You are correcting this translation as project lead.** (for an accepted version: **You are correcting this accepted translation as project lead.**)
4. Correct the translation as described in [Review a translation](annotator.md#review-a-translation). Only **Accepted with corrections** is offered.
5. Submit with **Submit review…** (or \`Ctrl+Enter\`), then click **Back to Documents**. If your text has spacing errors or invisible characters, the confirmation names them, for example *1 typography hint in your text: double space.*; **Show them** shows the places, **Keep editing** lets you fix them. The line blocks nothing.
6. After the correction of an accepted version, assign the review of the new version as usual. The annotation work on the old version is handled with **Handle text change…** and *Carry to v2…* ([Handle a text change for open annotation work](#handle-a-text-change-for-open-annotation-work)); with **Annotate only after the translation review is accepted** on, the row offers them once the new version is accepted.

While your correction of an accepted version is open, **Ask a reviewer to correct…** for the same version is refused (*A lead is correcting this version.*): submit your correction first, or withdraw it with **Remove…** in your row of the **Translation** part.

To give a reviewer you asked with **Ask a reviewer to correct…** more to look at, add to the reason with **Add to the reason…** in their row of the **Translation** part while the review is open ([Add to the reason of a correction request](lead-documents.md#add-to-the-reason-of-a-correction-request)). The reason as sent is never changed. The reason of **Reopen…** has no such addition.

### Accept a translation that was not reviewed

What for: annotate a translation that was reviewed outside Ontotator. The row's next step is **Translation not accepted**.

1. In the row, click **Assign review or accept…**.
2. Choose one:
   - Click **Turn translation review on**, then assign a review.
   - Tick **This translation was reviewed outside Ontotator — accept it as it is**, enter a **Reason** and click **Accept and annotate**.

Ontotator records the acceptance with your name, the reason and the time. It accepts the newest version of every translation of the text, parallel translations included. To accept only one of them, use [Accept one translation version](#accept-one-translation-version). To have an accepted translation reviewed after all, click **Assign a new review…** in the **Translation** part of the text card.

### Accept one translation version

What for: accept exactly one version, for example an imported correction that was checked outside Ontotator, without touching the other translations of the text.

1. Open the text card and click **Translation**.
2. At the version, click **Accept this version…**. It is offered at the newest version of a translation that is neither reviewed nor accepted.
3. Enter a **Reason**, for example *Checked against the DeepL output*. The dialog says how the acceptance will read: *It is recorded as “Accepted: reviewed outside Ontotator”, with your name, the reason and the time: no translation review in Ontotator stands behind this version. Say in the reason how it was checked.* Do not use this to decide a query: under **Resolve…**, **Accept the reviewer’s text…** and **Answer and accept the version as it is…** record your decision on the query and tell the reviewer ([Resolve a rejected or queried translation](#resolve-a-rejected-or-queried-translation)).
4. Click the button that names the version, for example *Accept v2*.

The version then reads like other acceptances, for example *Accepted: reviewed outside Ontotator, Project lead (ann-0002), 14 Nov, 19:40, Checked against the DeepL output*. While a translation review of the version is open, the acceptance is refused: withdraw the review with **Remove…** first.

### Upload a new version of a translation

What for: bring in a text made outside Ontotator, for example a new machine translation, a translation by a person or a version you corrected by hand, as the next version of one translation.

1. Open the text card and click **Translation**.
2. At the newest version of the translation, click **Upload a corrected text…**. The dialog says which version the text becomes, for example *The text becomes v3, a correction of v2.*
3. Give the text: with **Paste text**, paste the whole text into **New text**; with **Choose file**, choose one UTF-8 text file (.txt). The file only fills the text; its name does not matter.
4. Under **How was this text made?**, choose **Machine translation**, **Human translation** or *Correction of v2 by hand*. For a machine translation, enter the **Provider** (for example DeepL); **Model or tool** is optional. **Made on**, **Made by** and **Note** are optional as well.
5. Click **Check changes**. The dialog shows the changes against the current version, for example *Changes to v2 · 2 passages changed*, with added words underlined and removed words struck through. **Back** returns to the text.
6. Click the button that names the new version, for example *Save as v3*.

The new version is always a correction of the version you started from. It starts as *Ready for review* and sets **Review** to **On** for the text; nothing is accepted by the upload. Assign a translation review as usual, or accept the version with **Accept this version…** if it was reviewed outside Ontotator ([Accept one translation version](#accept-one-translation-version)). The version row then shows how the text was made and who uploaded it, for example *Correction of v2 · Machine translation, DeepL, deepl-2026-10* and *Uploaded by Project lead (ann-0002), 16 Nov, 10:12 · Made on 12 Nov 2026 by Dr. Roe · Checked against the source*.

If people worked on the current version, the dialog says so before you save, for example *Annotation has work on v2. 3 annotations (2 submitted, 1 open) stay on v2. After saving, the row offers Handle text change…*. Open consolidations and a final result stay on that version too. Handle them afterwards with **Handle text change…** and *Carry to v3…* ([Handle a text change for open annotation work](#handle-a-text-change-for-open-annotation-work)).

The upload is refused in these cases:

- A translation review of the version is open: *A translation review of this version is open.* Withdraw it with **Remove…** in the reviewer's row of the **Translation** part first.
- The text is the same as the current version: *No changes to v2. Nothing is saved.* A line break at the end of a file does not count as a change.
- The file is not a .txt file, is not UTF-8 or is larger than 1 MB.

A source text has no **Upload a corrected text…**: a corrected source text comes in as an Ontospan bundle ([Corrections and parallel translations in a bundle](lead-documents.md#corrections-and-parallel-translations-in-a-bundle)). The same applies to a parallel translation that should stand beside the current one. An exported Ontospan bundle does not yet carry the provider and model of an uploaded version; they are kept in Ontotator.

### Fix a typo in a translation without a review

What for: correct spacing, a typo or grammar in a translation without a translation review. The content of the text stays as it is, and an accepted text stays accepted. Ontotator calls this an editorial correction; the API, the MCP tool and the name of the action in the audit trail use that term.

1. Open the text card and click **Translation**.
2. At the newest version of the translation, click **Fix typos…**. Unlike **Correct it myself…** and **Upload a corrected text…**, it keeps the status of the text and starts no review.
3. Correct the text under **Corrected text**. It starts with the text of the version. The words you change are marked while you type, and the changes appear below the field with removed text struck through and a count, for example *Changes to v2 · 1 character changed*.
4. Under **What did you fix?**, click **Spacing**, **Typo**, **Grammar** or **Removed addition** (words the machine added that the source does not have, for example a synonym in brackets); you can choose several. **Note** is optional, for example the word you corrected. One of the two is required and is kept with the version.
5. Read what happens to the work on the version (see below) and the status line, for example *v3 keeps the status of v2: Accepted. No translation review is started.*
6. Click the button that names the new version, for example *Save as v3*.

If a number changes, the dialog points it out, for example *Changes a number: 15 → 50. Check that this is intended.*; you can still save.

The corrected text becomes the next version of the translation, a correction of the version it fixes with that version's status: the correction of an accepted v2 is an accepted v3, and v2 stays accepted as well. A version that was rejected or queried can be corrected too: its correction is rejected or queried like it, and you resolve it as before ([Resolve a rejected or queried translation](#resolve-a-rejected-or-queried-translation)). The corrected version is then the text of the row: **Assign a new review…** and **Assign review…** assign a review of it (the dialog names the version, for example *case-0102 de v2*), the reviewer reads the corrected text, and **Translation details** in the review says *Typos fixed by the project lead on …* with what you fixed. The version you corrected takes no further review: its submitted review has no **Reopen…**, and the options under **Resolve…** have no reopen item; assign the review again instead, also to the person who reviewed the earlier version. If the reviewer rejects or queries the corrected version, it stays the text to resolve. No translation review is started and **Review** is not changed. The version row names the correction, for example *Typo fix by Project lead (ann-0002), 17 Nov, 10:12 · Spacing; Typo*, and **History** has a line for it, for example *typos fixed in v3 by you, 17 Nov, 10:12: Spacing; Typo*. On Documents the **Translation** state of an accepted text you corrected reads *Accepted, typos fixed by you, v2 → v3* (on a wide screen *accepted* with the marker *v3 corrected*). The audit log records who corrected the text, the changed passages and the reason.

What happens to work on the corrected version:

- If nobody worked on it, the dialog says so: *Nobody has worked on v2 yet.*
- Annotation tasks nobody opened move to the new version: *2 waiting tasks continue on v3.*
- A submitted annotation moves to the new version by itself when every finding is placed on the new text without doubt and the fix changes no number: nobody clicks, and the person does not submit again. Under the changes, the dialog says per person whose annotation moves and whose does not, and why, for example *Moves to v3 by itself, nobody submits again: the annotation of Tom Reis.* and *Not moved by itself, a finding marks words you changed: Ana Weber.* An annotation does not move by itself when the fix changes a number (a digit added, removed or changed anywhere in the text; *0.5* → *0,5* or *12.03.* → *12. 03.* is no change of a number, *12* → *1 2* is one), when the text has a final result or a consolidation, when the translation is not accepted yet, when it was annotated from tool proposals (they reach the new version later), when the task is paused, or when a finding marks words you changed. The moved annotation is the same person's annotation: same findings and guideline version, placed on the new text, and the task on the old version goes away. It is not a second annotation: agreement, the counts on Documents and Progress and the work export are the same as before the fix, and it adds no working time. **History** has a line for it, for example *annotation of Tom Reis (ann-0004) moved to v3 by itself after the typo fix, 17 Nov, 10:12*, and the audit log records it with the submission it came from. To let the person look at it again, reopen the task on the new version as usual. After saving, the message says how many moved, for example *1 annotation moved to v3.*
- Other annotations that were opened or submitted, open consolidations and a final result stay on the corrected version. Only then the dialog shows a highlighted block, *Work stays on v2*, with what stays and what to do, for example *2 annotations stay on v2. After saving, use Handle text change… and Carry to v3… on this row to move them.* Move started work with **Handle text change…** ([Handle a text change for open annotation work](#handle-a-text-change-for-open-annotation-work)) and submitted work with *Carry to v3…* ([Carry submitted work to a new text version](#carry-submitted-work-to-a-new-text-version)). The block also says how many findings mark words you changed and will need a check.
- Tool proposals move to the new text; a proposal whose marked words were changed waits for a check, as after a corrected translation review.

The correction is refused in these cases, and the dialog says so in place:

- A translation review of the version is open: *A translation review of this version is open.* Withdraw it with **Remove…** in the reviewer's row of the **Translation** part, or make the fix in that review.
- The version is not the newest of its translation or it was discarded.
- The text is unchanged: *No changes to v2. Nothing is saved.*

A source text has no **Fix typos…**; a corrected source text comes in as an Ontospan bundle. A change of content, for example a different finding or a rewritten sentence, belongs in a translation review ([Correct a translation yourself](#correct-a-translation-yourself)).

The same correction can be made without the browser: the MCP tool \`editorial_correction\` ([MCP server guide](../../mcp/README.md)) and \`POST /api/v1/projects/{key}/documents/{document_id}/editorial-correction\` take the passages to replace, each with its replacement, and the reason, with a project token of a lead that has the scope *Project administration*. Without \`confirm\` the tool changes nothing and returns the changed passages and what would follow.

### Handle a text change for open annotation work

What for: decide what happens when a text gets a new version while someone is still annotating the old one. The row's next step is **Handle text change**.

Before you start: if the task is paused by a problem report, [decide the report](#decide-on-a-problem-report) first. To see what changed, compare the two versions in the text view with **Show changes** ([Read a text and other people's work in the text view](lead-documents.md#read-a-text-and-other-peoples-work-in-the-text-view)).

1. In the row, click **Handle text change…**. A task on a correction that was not accepted only offers **Withdraw**. The dialog says why and what to do next.
2. Choose one:
   - Move to the new version: the annotator continues on the corrected text; their draft findings are carried and marked for checking. In a task from proposals their decisions on the proposals are carried, and only what needs a check is marked.
   - Let the annotator finish on the old version: the result is carried to the new version for them to check.
   - **Withdraw**: the task ends, nothing of the draft is carried, and the new version needs a new annotation. Assign it afterwards.
3. Click **Apply**.

Work from proposals is carried too: the decisions on the proposals move to the matching proposals of the new version, and only what touches a changed passage is marked **Check needed**. An accepted, edited or Unresolved proposal without a counterpart in the new version becomes the annotator's own finding and is marked **Check needed** too; an Unresolved one keeps its note. A rejected proposal without a counterpart is dropped. If the new version has no proposals yet, the dialog says so: their automatic transfer may still be running, or they must be imported. Until then the move and finishing on the old version are not available, and nothing is preselected. Wait for or import the proposals for the new version, then click **Retry**, or choose **Withdraw**. To annotate the new version from scratch instead, [change the annotation mode of the text](lead-documents.md#change-the-annotation-mode-of-one-text); that discards the work of the whole text.

### Carry submitted work to a new text version

What for: reuse submitted findings after the text was corrected. The row's next step reads, for example, *Carry to v2…*.

Before you start: to see what changed, open the text view of the old version, click **Compare**, choose the new version on the right and tick **Show changes** ([Read a text and other people's work in the text view](lead-documents.md#read-a-text-and-other-peoples-work-in-the-text-view)).

1. In the row, click the carry button, for example *Carry to v2…*.
2. Choose who continues: the author, **Someone else…** (then pick the **Annotator**), or start the new version fresh, for example *Start v2 fresh*: nothing is carried, and the assign dialog opens next.
3. Click **Assign**.

A submission is carried to a version once. If you withdraw or remove the carried task before the person submits it, the row offers the carry again, for example *Carry to v2…*. The fresh start, for example *Start v2 fresh*, is final.

Work from proposals is carried too: the decisions on the proposals move to the matching proposals of the new version, and only what touches a changed passage is marked **Check needed**. An accepted, edited or Unresolved proposal without a counterpart in the new version becomes the annotator's own finding and is marked **Check needed** too; an Unresolved one keeps its note. A rejected proposal without a counterpart is dropped. If the new version has no proposals yet, the dialog says so: their automatic transfer may still be running, or they must be imported. Wait for or import the proposals for the new version, then click **Retry**. To annotate the new version from scratch instead, [change the annotation mode of the text](lead-documents.md#change-the-annotation-mode-of-one-text); that discards the work of the whole text. Until the new version has proposals, the row's **Annotation** column reads *v1 work waits* with *v2 has no proposals yet*, and *Carry to v2…* is disabled with the hint *Import proposals for v2*; it works as soon as the proposals are there. To assign the new version anew instead, use the text card.

If **Assign** fails because the new version has no proposals, or because of a server or connection problem, the dialog offers **Retry**. Other refusals say why, without **Retry**.

The annotator must check the carried findings before submitting ([Review carried findings](annotator.md#review-carried-findings)).

## Problem reports

Annotators and reviewers can report a problem with a text. This pauses their task until you decide.

### Decide on a problem report

What for: answer a report and let the work go on.

1. On **Documents**, click **Decide on report…** in the row. Or click **Decide on report…** in the problem report's notice of the text card.
2. Read the report: who reported it, the reason and the history.
3. In the common case, write an optional answer and click the close-and-resume button, for example *Close and resume the annotation of CASE-1 de by Ana Weber (ann-0004)*. The page names a task by its kind, text and owner, not by a number.
4. For other cases, open **Other decisions** and choose one:
   - **Close report…** or **Close, keep paused…**: close it with an outcome for the reporter.
   - **Release pause…**: let paused tasks continue.
   - **Pause other tasks…**: pause other tasks on the same text or project.
   - **Agree clean restart…**: restart the task with a new round, after agreeing with the reporter. The annotator's own findings are not carried over. A task from scratch starts empty; a task from proposals starts again on the newest proposal set of the text, all proposals open, so a newer tool set reaches the task this way. The text card's **Annotation** then names that set; *Newer set available* goes away once every task of the text works on it.
   - **Reopen report…**: open a closed report again.
5. Confirm in the form that opens.
6. Click **Back to Documents**, or go to the next decision.

![The decision card of a problem report. Close and resume is the common decision; the others are under Other decisions.](images/lead-problem-report.png)

A final result is never changed here. If a task is still paused after the report was closed, the row shows **Resume task…**; click it and release the pause.

If a lead paused the text of the report ([Pause and release the work on texts](lead-documents.md#pause-and-release-the-work-on-texts)), the page shows **Paused by lead** under *Text*. That pause is separate: after you close the report and release its pause, the task stays paused, marked **Paused by lead** for its person, until the text is released; the message after your decision says so. **Agree clean restart…** is refused while the text is paused.

## Export

### Export final results

What for: download the accepted final results.

1. In the sidebar, click **Export**. Or click **Export final results…** on **Documents** or **Progress**.
2. The card **Final results** checks every text. It lists texts that need your decision and texts left out because they have no final result. Texts with annotation off in the work plan that still have a final result are listed under **Not planned, not exported**, for information only; they are not exported. Texts with annotation off and no final result are not listed. If you took texts out of the work plan, a line below the check counts them all and names the file that lists them, for example *4 texts taken out of the work plan are listed in planned-out.csv* (with Phenopackets: *… in README.txt*).
3. Under **Format**, keep **Results with receipt (ontospan)**, or choose **Phenopackets (derived, lossy)**; see [Phenopackets](#phenopackets).
4. If texts need your decision or are left out, a tick box names how many results are exported and how many texts are left out, for example *Export the 3 results as they are; leave out the other 243 texts*. Tick it to export now anyway. Without the tick, **Create final export** does not start. The export's README.txt lists the left-out texts and the warnings you acknowledged with this tick. Left out here means planned for annotation but without a final result.

   Texts you took out of the work plan (annotation set to off after it was on) are named too: README.txt and index.csv list them, and planned-out.csv gives for each the plan revision, the time and the reason you entered in **Plan…** or when you discarded the translation. The Phenopackets ZIP names them in README.txt and lists them under \`planned_out\` in receipt.json. A final result such a text had stays in Ontotator and is not exported. Texts that were never in the plan are not listed.
5. Click **Create final export**.
6. When it is ready, click **Download (ZIP)**.

![The final results check on the Export page](images/lead-export.png)

Click **Check again** after you accepted more results. **What is in the file?** explains the contents of the chosen format. With **Results with receipt (ontospan)**, the results are in selected-results.ontospan.zip, an Ontospan bundle. Besides the results, the file holds tables for analysis: every finding with its values, origin and text passages (findings.csv), the agreement between the annotators of each text, per text and for the whole project (agreement.csv, agreement-summary.csv), and what the annotators did with each tool's proposals, with the tool's precision and recall against the final results (proposals.csv). If you took texts out of the work plan, planned-out.csv names them with the reason. For a text you accepted directly, the file also holds the other annotations of it in compared-results.ontospan.zip, marked *compared*, so that the agreement covers it; they are not final results. Agreement is given as F1 values only. Values that annotators never confirmed are marked as *defaulted* in the file; proposals still unresolved in an accepted submission keep their reviewer flag and note. Once a consolidator decides such a group, the result is a normal decided finding, or no finding if left out, and the annotator's note stays in the provenance part of the export. The file formats are described in the [scientific workflow guide](../scientific-workflow.md) and the [translation review export guide](../translation-review-export.md).

Each text in an export names the ontology release its work was made under, which can be older than the project's current release. If the texts of one export were made under different releases, the newest keeps the layer ID (for example \`hpo-layer\`) and each older release gets a layer of its own (\`hpo-layer@<start of its checksum>\`), which the file lists with its release and checksum.

### Phenopackets

What for: hand the final results to tools that read GA4GH Phenopackets (schema v2).

The Phenopackets come from the same check and the same accepted results as the results with receipt; nothing is selected again. The ZIP holds one Phenopacket per text, a report per text of what was left out, a summary (report.json), a README.txt and the selected results themselves as an Ontospan bundle (selected-results.ontospan.zip). The Phenopackets are derived and lossy; the Ontospan bundle is the complete record, the same file as the selected results in **Results with receipt** made from the same check.

- Only findings about the patient on the HPO layer become phenotypic features. Findings about family members or other persons, with an unknown experiencer, with assertion *uncertain*, or left unresolved in consolidation are left out and counted in the reports. Findings of other layers are skipped.
- Assertion *absent* becomes an excluded feature.
- Time: a feature gets an onset only from an onset modifier of the finding, for example *Childhood onset*. A historical finding is exported like a current one, because a Phenopacket cannot say "in the past"; the reports count these, and the Ontospan bundle keeps the temporality.
- Each feature points to its finding in the Ontospan bundle of the same ZIP, so you can look up the text passage it was found in.
- Each Phenopacket is named after the text (its document ID), which is also the subject. Texts of the same patient are not grouped into one Phenopacket yet.

An operator can create the Phenopackets of the newest final export on the command line, with \`ontotator admin export PROJECT OUT.zip --format phenopacket\`.

### Export research data

What for: download raw material for analysis. People appear as pseudonyms.

1. On **Export**, go to **Research data**.
2. Choose a row: **Annotation results**, **Edit log**, **Working time** or **Translation reviews**. **Working time** holds data only if the project records working time ([Record working time](lead-settings.md#record-working-time)).
3. Click **Create**, then **Download** when it is ready.

Download an export within 24 hours: the server then deletes its file, and you create the export again. You can have at most 3 exports and uploads waiting at a time; one more is refused until one of them has started.

How to analyse these files is described in the [scientific workflow guide](../scientific-workflow.md).

### Export history

What for: find an earlier export again, see who made it and why one failed.

**Export history** at the bottom of **Export** is closed at first; click it to open the list. It lists every export of the project, newest first: final results, Phenopackets and the research data, also those that other leads or an API token started. Each row shows the export, its state (*Waiting*, *Running*, *Ready* or *Failed*), who requested it (*Command line* for one started on the server), when it started (to the minute) and how long it ran, for example *4 s* or *1 min 12 s*; *–* while it is still waiting or running. Point at the duration for the exact start and finish times. A failed export shows its error code under *Failed*; point at it for the full message.

- Click **Download** to save the file of a finished export again, within 24 hours of the export. Then the server deletes the file and the row has no **Download** any more: create the export again. The server checks your rights again on every download.
- Click **Show older exports** for the next 20.
- While the list is open, it updates when you create a research export here. Click **Refresh history** to see a final export or exports others started meanwhile.

Only leads and system administrators see the history. People appear by name and pseudonym, as elsewhere for leads.
`,_=`# Lead: project settings

This chapter is for project leads. It covers every tab under **Settings**: the project name and languages, the ontology, the submission rules, the workflow, the people and the guidelines. Back to the [lead overview](lead.md).

General, Annotation, Workflow and Ontology have a **Save changes** button at the bottom. People and Guidelines save each change at once.

| Tab | What you set there |
| --- | --- |
| **General** | [Name and description](#change-the-project-name-and-description), [languages of the texts](#set-the-languages-of-the-texts); for system administrators also [Delete this project](admin.md#delete-a-project-without-work) |
| **Annotation** | [Submission rules](#set-the-submission-rules), [prefilled values](#set-prefilled-values-for-new-findings), [values annotators can choose](#limit-the-values-annotators-can-choose) |
| **Workflow** | [Plan for new imports](#choose-the-plan-for-new-imports), [texts with tool proposals](#choose-how-texts-with-tool-proposals-are-annotated), [annotators per text and consolidation rules](#set-annotators-per-text-and-the-consolidation-rules), [working time](#record-working-time) |
| **Guidelines** | [Publish](#publish-the-first-or-a-new-guideline-version), [see who read them](#see-who-has-read-the-guidelines), [republish](#republish-an-earlier-guideline-version), [withdraw](#withdraw-a-guideline-version) |
| **People** | [Add](#add-a-member), [change roles](#change-a-members-roles), [remove](#remove-a-member) |
| **Ontology** | [Ontology version and annotation scheme](#choose-the-ontology-version-branches-and-annotation-scheme), [task profile](#task-profiles) and [replacing it](#replace-the-task-profile), [move to a newer release](#move-a-started-project-to-a-newer-release), [translations](#see-which-translations-the-project-uses) and [the newest translations](#use-the-newest-translations) |

## Open project settings

What for: reach all settings of the current project.

1. In the sidebar, click **Settings**. You can also click **Settings** in the project's row on **Projects**.
2. Choose a tab: **General**, **Annotation**, **Workflow**, **Guidelines**, **People** or **Ontology**.
3. After a change, click **Save changes**. The page then says, for example, *General saved.*
4. To undo your edits before saving, click **Discard changes**.

If you leave a tab with unsaved edits, a dialog asks you to **Save changes**, **Discard changes** or **Cancel**.

## Change the project name and description

What for: give the project a clear name and a short description on **Projects**.

1. Open **Settings**, tab **General**.
2. In the card **Name and description**, edit **Name** and **Description**.
3. Click **Save changes**.

## Set the languages of the texts

What for: make sure every imported text is in a language you expect. An import refuses texts in other languages. Leave the list empty to allow any language.

1. Open **Settings**, tab **General**, card **Languages**.
2. Type a language code into **Languages of the texts**, for example \`de\`.
3. Press Enter or click **Add language**.
4. To remove a language, click ✕ next to its code (its name is *Remove de*, for example).
5. Click **Save changes**.

A typed code that you did not add blocks saving: **Add this language code before saving.**

## Choose the ontology version, branches and annotation scheme

What for: decide which ontology release annotators search in.

Before you start: you can change this until the first work is submitted. After that, see [Move a started project to a newer release](#move-a-started-project-to-a-newer-release).

1. Open **Settings**, tab **Ontology**.
2. In **Ontology version**, choose the release for each ontology. Only releases an administrator uploaded on **Ontologies** are offered.
3. Optional: open **Advanced**.
   - Limit the terms to some branches (parts of the ontology below one term): enter term codes separated by commas, for example \`HP:0000118\`. Empty means every term.
   - Choose the annotation scheme: **HPO phenotype (fixed qualifiers, modifiers)** or **Generic (free qualifiers)**. "Qualifiers" are the value fields of a finding.
4. Click **Save changes**. If the change would rewrite or flag terms in drafts, a check opens first, as in [Move a started project to a newer release](#move-a-started-project-to-a-newer-release).

## Task profiles

What it is: the task profile is a JSON file that defines what annotators work with: the ontology, the layers (for example *Phenotypes*), the finding types in each layer and the value fields of each finding type with their values (for example *Assertion*: present, absent, uncertain). It holds neither texts nor the ontology itself. Every project has exactly one. An administrator sets it when [creating the project](admin.md#create-a-project); a lead can [replace it](#replace-the-task-profile) until the first work is submitted.

The other choices on the same form belong to the project, not to the profile: the ontology file (release), the allowed branches and the annotation scheme (*HPO phenotype* with fixed values and modifiers, or *Generic* with free values). A profile file can give a starting value for the branches and the scheme; after that they are the project's, and they can change later under **Settings**, tab **Ontology**. Replacing the profile does not change them.

### Template or own file

The built-in template *HPO phenotype* is a ready profile: ontology \`HP\`, one layer \`hpo-layer\` (*Phenotypes*), finding type \`phenotype\`, and the value fields *Assertion* (present, absent, uncertain), *Experiencer* (patient, family_member, other) and *Temporality* (current, historical). New project fills in the branch \`HP:0000118\` (Phenotypic abnormality) and the scheme *HPO phenotype*.

- Use the template if you upload only plain texts, or Ontospan bundles that fit it: layer \`hpo-layer\`, ontology \`hp\` (upper or lower case), branches exactly \`HP:0000118\`, and no value outside the lists above.
- Use your own file in every other case, for example a bundle with another layer ID, another ontology, other branches or the value \`unknown\`. Whoever produces the bundles usually has the matching profile; ask them for it.

### What a profile file looks like

A shortened example. The checksum (\`sha256\`) and \`release\` are those of the ontology file uploaded on **Ontologies**; click **Copy** next to its checksum.

\`\`\`json
{
  "schema_version": "ontotator-task-profile/v1",
  "profile_id": "lab-phenotypes/v1",
  "version": "1.0.0",
  "ontologies": [
    { "ontology_id": "hp", "label": "Human Phenotype Ontology",
      "release": "2026-09-01", "sha256": "20d4a647…d193d0" }
  ],
  "layers": [
    { "layer_id": "hpo-layer", "label": "Phenotypes", "ontology_id": "hp",
      "access": "editable", "default_type_id": "phenotype",
      "annotation_types": [
        { "type_id": "phenotype", "label": "Phenotype",
          "axes": [
            { "id": "assertion", "label": "Assertion", "options": ["present", "absent", "uncertain"] },
            { "id": "experiencer", "label": "Experiencer", "options": ["patient", "family_member", "other", "unknown"] },
            { "id": "temporality", "label": "Temporality", "options": ["current", "historical", "unknown"] }
          ] }
      ] }
  ],
  "default_layer_id": "hpo-layer"
}
\`\`\`

| Field | Meaning |
| --- | --- |
| \`ontology_id\` | The ontology's short ID, for example \`hp\`. Upper and lower case count as the same. It cannot change once the project exists. |
| \`release\`, \`sha256\` | The ontology file the project uses. They must be those of the file chosen on the form. |
| \`allowed_roots\` (optional) | The branches a new project starts with, for example \`["HP:0000118"]\`. \`[]\` means the whole ontology. Left out: the form starts empty, and \`ontotator admin projects create\` starts with \`HP:0000118\` for the scheme *HPO phenotype*. Use \`[]\` for bundles built for the whole ontology, as a new project must have the same branches as the bundle. |
| \`t1_profile\` (optional) | The annotation scheme a new project starts with: \`hpo-phenotype\` or \`generic\`. Left out: *HPO phenotype* for HPO on the form, *Generic* otherwise; \`ontotator admin projects create\` starts with *Generic*. |
| \`layer_id\` | The layer's ID. Bundles name it for each proposal. |
| \`axes\` | The value fields and their allowed values. With the scheme *HPO phenotype* only \`assertion\`, \`experiencer\` and \`temporality\` with the values above are possible; a profile may leave values out. |
| \`default_layer_id\` | The layer annotators start in. |

### What must match a bundle

An Ontospan bundle is checked against the project when you click **Check** in **Upload texts…**. Each layer of the bundle must fit:

| In the bundle | Must match | Who can change it |
| --- | --- | --- |
| Ontology ID | The profile's \`ontology_id\` (case does not matter) | Nobody: it is fixed when the project is created. An administrator creates a new project. |
| Layer ID | A \`layer_id\` of the profile | A lead, by [replacing the task profile](#replace-the-task-profile) until the first work is submitted |
| Ontology release | The project's ontology version | A lead, under **Settings**, tab **Ontology**; an administrator uploads the release first if it is missing |
| Allowed branches | Exactly the project's branches | A lead, under **Settings**, tab **Ontology**, **Advanced**, until the first work is submitted |
| Annotation scheme | The project's annotation scheme | As for the branches |
| Values of each proposal | One of the profile's values | A lead, by replacing the task profile |

When something differs, the check names it per text, for example *Layer hpo-layer: the bundle uses release 2026-09-01, this project uses release 2026-06-23*, and says who can change it. Nothing is imported.

## Replace the task profile

What for: change the layers, finding types and value fields annotators work with. See [Task profiles](#task-profiles).

Before you start: this is only possible until the first work is submitted. The new file must name the same ontologies as the project (the same \`ontology_id\`; upper and lower case count as the same) with the \`release\` and \`sha256\` of the version chosen under **Ontology version**. Otherwise saving is refused; the ontology of a project cannot change.

1. Open **Settings**, tab **Ontology**, and open **Advanced: task profile**.
2. Check **Current profile layers**.
3. Choose a JSON file in **Profile file (JSON)**. The new layers appear under **Profile layers**.
4. Click **Save changes**. The page says *Task profile saved.*

## Move a started project to a newer release

What for: move to a newer ontology release after work was submitted. Drafts are updated; submitted work stays as it was submitted.

Before you start: an administrator must have uploaded the new release ([Upload ontology releases](admin.md#upload-ontology-releases-and-translation-files)).

1. Open **Settings**, tab **Ontology**. The card **Ontology** shows the current release.
2. Under **Move to another release**, choose the new release.
3. Click **Check changes**.
4. Read the panel **Check before moving**:
   - The first table (**Becomes**, **Why**) lists draft terms that will be replaced by their successor.
   - The second table (**Status**, **Suggestions**) lists draft terms that are obsolete or missing in the new release, and proposals on such terms that are not yet rejected or replaced. Proposals are never rewritten. Their annotators must change them before submitting.
5. Click **Move to this release**, or **Cancel**. The page says **Ontology release changed.** The card **Translations** then reads *Not frozen yet.* until the next term search ([See which translations the project uses](#see-which-translations-the-project-uses)).

![The check before moving to another release. The first table shows which draft terms are replaced automatically, the second which ones annotators must change by hand.](images/lead-move-release-check.png)

If drafts changed meanwhile, you see **Drafts or pins changed since the check. Check the changes again before moving.** Click **Check changes** again.

Tasks already opened stay open and keep their drafts. A submitted task shows what was submitted, also when it is reopened: terms the new release retired are then flagged at submit. Exports name the release recorded with each text ([Export](lead-results.md#export)).

## See which translations the project uses

What for: check which translation files term searches use in this project.

1. Open **Settings**, tab **Ontology**.
2. Read the card **Translations**.
   - *Not frozen yet.* The first term search or opening a text in the editor takes the translation files on the server then. The card also reads like this right after **Move to this release**: the move ends the earlier freeze, and the next use freezes again.
   - *No translations: searches use the English names only.* The project froze when no translation file was on the server.
   - Otherwise the card lists the frozen files with their language, ontology and checksum. *Uploaded later, not used here* names files on the server that the project does not use.
   - *Translations updated on …* says when and by whom the project last moved to the newest translations: by display name and pseudonym, or *from the command line*. Only leads and system administrators see who; other members see only when.
   - **Earlier translations** lists, collapsed, the files earlier searches used and until when.

The project froze its translations at the first use of its ontology. A file an administrator uploads after that does not reach the project by itself ([When a translation reaches a project](admin.md#when-a-translation-reaches-a-project)). To use it, see [Use the newest translations](#use-the-newest-translations). Changing the ontology version, the branches or the annotation scheme, or replacing the task profile, ends the freeze: the next use takes the files on the server then. The ended files are listed under **Earlier translations** once the project is frozen again.

## Use the newest translations

What for: let term searches use translation files that were uploaded after the project froze its translations.

Before you start: an administrator must have uploaded the files ([Upload ontology releases and translation files](admin.md#upload-ontology-releases-and-translation-files)). Leads of the project and system administrators can do this.

1. Open **Settings**, tab **Ontology**, card **Translations**. *Uploaded later, not used here* names the new files.
2. Click **Use the newest translations**. The button is only there when such a file exists.
3. Read the dialog **Use the newest translations?**. It names each file that is added, or replaced by a newer file of the same name.
4. Click **Use the newest translations**, or **Cancel**. The card now lists the new files and says *Translations updated on* the date *by* your display name and pseudonym.

What changes: the next term search in the project uses the new files. It can find terms by the names in them.

What does not change:

- Findings. They store the term ID, for example the HPO ID, not the translated name.
- Drafts and submitted work.
- The record of earlier searches. Each one keeps the translations it ran with; they are listed under **Earlier translations**.
- Files the project already uses. A file stays even when the server no longer has it.

You can do this at any time, also while work is open or submitted. A change an annotator saves at that very moment may be refused with *Changed elsewhere – reload required*; reloading the case fixes it. If no file is newer, the page says *The project already uses the newest translations.*

## Set the submission rules

What for: decide what annotators must do before they can submit.

1. Open **Settings**, tab **Annotation**, card **When submitting**.
2. In **Findings that point to no text passage**, choose **Not allowed**, **Allowed with a reason** or **Allowed, reason optional**.
3. Tick **Annotators must confirm every value before submitting** if prefilled values may not be submitted unconfirmed.
4. Tick **A finding must be one continuous passage** if a finding may not have several text segments.
5. Click **Save changes**. The rules apply to every submission from now on.

## Set prefilled values for new findings

What for: new findings start with these values. They stay marked as not confirmed until the annotator confirms or changes them.

1. Open **Settings**, tab **Annotation**, card **Prefilled values**.
2. For each value field, choose a value, or **No prefill**.
3. Click **Save changes**.

## Limit the values annotators can choose

What for: hide values the project does not use from the editor.

1. Open **Settings**, tab **Annotation**, and open **Values annotators can choose**.
2. Click a value to switch it off (hidden) or on (shown). The prefilled value of a value field cannot be hidden: it is greyed, and the row says why, for example *“Present” is prefilled and cannot be hidden.*
3. Click **Save changes**.

Existing findings keep their values. A finding with a hidden value must be changed before it is saved again.

## Choose the plan for new imports

What for: decide whether newly imported translations get a translation review and an annotation by default.

1. Open **Settings**, tab **Workflow**, card **New imports**.
2. Choose **Plan review and annotation for every translation** or **Plan nothing; I plan texts on Documents**.
3. Click **Save changes**.

With **Plan nothing; I plan texts on Documents**, new texts appear on **Documents** as *Not decided* (filter **Not decided**) until you plan them ([Plan several texts at once](lead-documents.md#plan-several-texts-at-once)).

## Choose how texts with tool proposals are annotated

What for: set the project default for texts that came with tool proposals.

1. Open **Settings**, tab **Workflow**, card **Texts with tool proposals**.
2. Choose **Annotators work from the proposals** (they confirm, reject, correct and add) or **Annotators start from scratch** (proposals are hidden).
3. Click **Save changes**.

A text's own plan can override this until work on it starts.

## Set annotators per text and the consolidation rules

What for: decide how many people annotate each text and who may consolidate.

1. Open **Settings**, tab **Workflow**, card **Annotation and consolidation**.
2. Set **Annotators per text** (1 or more). It is an upper limit; fewer is fine. Ontotator has no maximum of its own. The administrator of the server can set one: the hint below the field then names it, for example *This server allows at most 8.*, and a larger number is refused. A number saved before the server got its maximum stays until you change it. A single text can have its own number, with the same bounds ([Assign work to the selected texts](lead-documents.md#assign-work-to-the-selected-texts)). The agreement compares every two annotators of a text, so a text with 20 annotators adds 190 pairs to agreement.csv, and one with 30 adds 435.
3. Tick **Annotate only after the translation review is accepted** if translations must be reviewed before annotation. Nobody can then annotate a translation that is not accepted; you can still assign annotators while the review is underway ([Assign work to the selected texts](lead-documents.md#assign-work-to-the-selected-texts)).
4. Tick **Consolidator must not be one of the text's annotators** if annotators may not consolidate their own texts.
5. Tick **Hide annotator names during consolidation** if consolidators should decide without knowing who marked what. Off by default.
6. Click **Save changes**.

Lowering the number removes nobody; existing assignments stay. A text can have its own number instead, set in the assign dialog ([Assign work for one text](lead-documents.md#assign-work-for-one-text)); it keeps it when you change the project setting.

With hidden names, a consolidator sees the annotators of a text as *Annotator A*, *Annotator B* and so on, in the order they submitted, instead of names or pseudonyms; the same letters are used in the consolidation, the full editor and the submitted work they read for it. A person keeps their letter in later consolidation rounds of the same task. The technical ids and checksums the consolidator's browser receives are scrambled too, so they cannot be used to work out who wrote a finding. Tool proposals keep their robot icon. You and other leads still see every name, and exports are unchanged. The change applies to every consolidation the next time it opens, also to one already started. The audit trail records the change as *Project settings changed*, with the setting named.

## Record working time

What for: measure how long annotation and translation review take, for example for a method study.

1. Open **Settings**, tab **Workflow**, card **Working time**.
2. Tick **Record working time**. It is off by default.
3. Click **Save changes**.

From the next opened task, annotation and translation review tasks show the person working a timer of their own active time. It pauses after 3 minutes without input (those 3 minutes still count, as reading time), while the tab is in the background and when the person pauses it ([Working time](annotator.md#working-time)). Everyone is told on their first task in the project. Consolidations are not timed.

You see sums only: **Progress** › **Working time** ([Watch progress](lead-documents.md#watch-progress)). The single work periods, under pseudonyms, are in the **Working time** research export ([Export research data](lead-results.md#export-research-data)). Switching the setting off stops recording; times already recorded stay. Like every settings change, the change is kept in the project's history.

## Add a member

What for: let a person work in this project.

Before you start: the person needs an account ([Create a user account](admin.md#create-a-user-account)).

1. Open **Settings**, tab **People**.
2. Click **Add member…**.
3. In **Username**, type at least three letters of the name, or the exact username or e-mail. Pick the person from the suggestions.
4. Tick one or more roles: **Lead**, **Annotator**, **Consolidator**.
5. Click **Add member**. The page confirms the new role. A username that is not accepted is said under the field. If you typed the name instead of choosing the suggestion, the message names the username to use.

Annotators also do translation reviews. Only people with the **Consolidator** role can be chosen as consolidator of a text. Ontotator sends no e-mail; tell the person that they were added.

## Change a member's roles

What for: give or take away a role.

1. Open **Settings**, tab **People**. The table **Project members** shows one row per person.
2. Tick a role checkbox to give the role. It saves at once.
3. Untick a role checkbox to take it away, then confirm with **Remove role**. This logs the person out on all devices; they can log in again right away. Taking away the lead role also revokes the project API tokens the person created for this project, unless they are a system administrator. Their personal tokens keep working, but no longer with the role you took away.

A project needs at least one lead: **Add another project lead before removing the last lead.** When you are the project's only lead and untick your own **Lead** box or click **Remove…** on your row, this message appears at once, without a confirmation.

The exception is a system administrator, who may take away the last lead, their own lead role included, for example to hand a project over. The dialog then says *This project will have no lead. You can still manage it as system administrator.* On their own row it does not speak of lost access or revoked tokens, because an administrator keeps both. A project without a lead shows "–" under **Lead** on **Projects** and can only be managed by an administrator until one is added ([Add a member](#add-a-member)).

## Remove a member

What for: take someone off the project.

Warning: if the person still has open work, removing them revokes their open assignments. Submitted work stays in the history.

1. Open **Settings**, tab **People**.
2. In the person's row, click **Remove…**.
3. Confirm with **Remove from project**.
4. If the person still has open work, the dialog **Revoke affected assignments?** lists it, annotations and translation reviews alike. Click **Remove and revoke their open assignments**.

## Give a script access to the project

What for: let a script import, export or read this project, for example a nightly export, without anyone's password.

1. Open **Settings**, tab **People**.
2. Under **Project API tokens**, click **New token…**.
3. Enter a **Token name**, tick the scopes it needs (**Read**, **Import**, **Export**, **Project administration**) and set **Valid for (days)**.
4. Click **Create token**. The dialog, titled with the name of the token (*New token “Progress report script”*), shows the token; it is shown only once. Click **Copy token** and store it, for example in your password manager.
5. Tick **I have stored the token**, then click **Close**. Until the box is ticked, the dialog cannot be closed, not with **Close** and not with the Escape key.

A project token works in this project only and acts as you, the lead who created it. It is revoked when you leave the project or lose the lead role (unless you are a system administrator), when you change your password and when your account is deactivated. Every lead of the project sees its tokens and can stop one with **Revoke…** and **Revoke token**. Changes made with a token are in the audit trail with the token's name.

A project token is also the safest kind for the Ontotator MCP server, which lets an AI assistant set up and run the project for you ([MCP server guide](../../mcp/README.md)). The line *Also for the Ontotator MCP server (AI assistant): see the handbook.* under the tokens opens this section.

## Publish the first or a new guideline version

What for: give annotators and reviewers the rules they work by. They find the guidelines in every task.

Before you start: published versions cannot be edited, only withdrawn. Check the file before you publish.

1. Open **Settings**, tab **Guidelines**.
2. Without guidelines, the form is already open (**No guidelines yet**). Otherwise, click **Publish a new version**.
3. Choose a \`.md\` or \`.txt\` file (UTF-8, up to 256 KB) in **Guideline file (.md or .txt, up to 256 KB)**.
4. Check the preview.
5. Optional: enter the version your document gives itself, for example *3.1*, in **Your version of the guideline (optional)** (one line, up to 40 characters).
6. Optional: describe the change in **What changed? (optional)**.
7. Click the publish button, for example *Publish as v2*. Or click **Discard**.

Everyone sees a notice in their next task.

The number after *v* counts the uploads of this project: the first file you publish is v1, the next one v2, also when you publish an earlier text again. It is not the version of your document. If your document has its own version, enter it in step 5: the app then shows it before the upload number everywhere, for example *Guidelines 3.1 (v2)*, *Guidelines updated to 3.1 (v2)* in the notice, and *Guidelines 3.1 (v2) (current: 3.2 (v3))* on a submitted result. Without it, everything reads *Guidelines v2*. Your version cannot be changed after publishing. To correct it, publish the text again with the right one.

## See who has read the guidelines

What for: check which version is in force and who has not opened it yet.

1. Open **Settings**, tab **Guidelines**. The top card shows the version **In force**.
2. Read **Seen by**. Open **who not yet?** to see the names.
3. Click **Read** to read a version. Close it with ✕.

Older versions are listed under **All versions**.

## Republish an earlier guideline version

What for: go back to an earlier text.

1. Open **Settings**, tab **Guidelines**.
2. In the row of the old version, click **More…**, then the republish item, for example *Republish v1…*.
3. The form opens with the old text and, if the old version had one, its own version in **Your version of the guideline (optional)**. Click the publish button, for example *Publish as v3*.

## Withdraw a guideline version

What for: remove a version that must no longer be read, for example because it contains a mistake.

Warning: the text of the withdrawn version is deleted for good. The version number and your own version of it stay, and results made under it show it as withdrawn, for example *Guidelines 3.1 (v2) (withdrawn)*. No guideline is in force until you publish or republish one.

1. Open **Settings**, tab **Guidelines**.
2. In the version's row, click **More…**, then the withdraw item, for example *Withdraw v2…*.
3. Optional: enter **Reason (optional)**. Do not repeat confidential content.
4. Confirm, for example with *Withdraw v2*.
`,v=`# Lead overview

This chapter is for project leads. A lead sets up the project, uploads texts, plans and assigns the work, accepts the results and exports them. Back to the [handbook overview](README.md).

As a lead you see an extra group in the sidebar with the name of the current project: **Documents**, **Progress**, **Settings** and **Export**. System administrators see the same pages for every project ([Open and manage any project](admin.md#open-and-manage-any-project)). How annotators and consolidators do their tasks is in the [annotator reference](annotator.md) and the [consolidator chapter](consolidator.md).

The lead's tasks are in four chapters:

| Chapter | Screen | What is in it |
| --- | --- | --- |
| [Lead: project settings](lead-settings.md) | **Settings** | Name, languages, ontology, submission rules, workflow, people, guidelines |
| [Lead: texts, work plans and progress](lead-documents.md) | **Documents**, **Progress** | Upload, the Documents table, the text card, work plans, assigning, progress |
| [Lead: results, decisions and export](lead-results.md) | **Documents** (Finalization), **Export** | Accept results, consolidations, translation and text-change decisions, problem reports, export |
| [Lead: change course in a running project](lead-change-course.md) | **Documents**, **Settings** | Use another translation, annotate texts again, narrow the scope, the command line |

## Typical project, start to finish

1. An administrator creates the project and makes you its lead ([Set up a new project for a lead](admin.md#set-up-a-new-project-for-a-lead)).
2. Check the ontology, the languages and the rules: [Lead: project settings](lead-settings.md).
3. Add the people who work with you, and give the **Consolidator** role to those who may consolidate: [Add a member](lead-settings.md#add-a-member).
4. Publish the guidelines: [Publish the first or a new guideline version](lead-settings.md#publish-the-first-or-a-new-guideline-version).
5. Prepare and upload the texts and choose their work plan: [Upload texts](lead-documents.md#upload-texts).
6. Assign translation reviews and annotations: [Assign work to the selected texts](lead-documents.md#assign-work-to-the-selected-texts). Ontotator sends no e-mail; tell people that work is waiting in their **My tasks**.
7. Follow the work and answer what needs you: [Watch progress](lead-documents.md#watch-progress), [Decide on a problem report](lead-results.md#decide-on-a-problem-report), [Resolve a rejected or queried translation](lead-results.md#resolve-a-rejected-or-queried-translation).
8. Accept one result per text, or start a consolidation when annotators disagree: [Accept a result or compare results](lead-results.md#accept-a-result-or-compare-results), [Start a consolidation](lead-results.md#start-a-consolidation).
9. Read the consolidators' notes and flags, and improve the guidelines where they were unclear: [Accept a consolidation](lead-results.md#accept-a-consolidation).
10. Export the final results: [Export final results](lead-results.md#export-final-results).

Try it with the demo project: the [demo project guide](../../examples/demo-project/README.md) walks through every step with invented clinical letters, tool proposals, translations and guidelines.
`,y=`/assets/admin-new-project-DJeXHg2E.png`,b=`/assets/admin-setup-code-C4hix8Tf.png`,x=`/assets/annotator-carried-finding-DGTlPuuk.png`,S=`/assets/annotator-editor-jXf6O-mh.png`,C=`/assets/annotator-finding-values-Bb8PsjvF.png`,w=`/assets/annotator-new-finding-C3T2Pu_V.png`,T=`/assets/annotator-proposal-review-DfYOL2KO.png`,E=`/assets/annotator-submit-dialog-BQBhy6Le.png`,D=`/assets/annotator-translation-review-BW3q4T4S.png`,O=`/assets/consolidator-group-table-B-z3dLzA.png`,k=`/assets/consolidator-submit-dialog-DZ_vab3x.png`,A=`/assets/getting-started-my-tasks-Dj-g7K81.png`,j=`/assets/getting-started-set-password-DTn32IS8.png`,M=`/assets/getting-started-user-menu-DHwA3qXv.png`,N=`/assets/lead-assign-CEatufaJ.png`,P=`/assets/lead-compare-results-CVUH1nDR.png`,F=`/assets/lead-documents-BdisNzWw.png`,re=`/assets/lead-export-CrRCHDGM.png`,I=`/assets/lead-move-release-check-xbVtZMTF.png`,L=`/assets/lead-problem-report-CseIMmtJ.png`,R=`/assets/lead-progress-DTbQZGVT.png`,z=`/assets/lead-text-card-CWnudQPz.png`,B=`/assets/lead-upload-preview-Dxn9_MXa.png`,V=`/assets/lead-work-plan-LVYfR41d.png`,H=`/assets/workflow-Dii9V6xB.png`,U=`https://github.com/phentrieve/ontotator/blob/main`,W=`https://handbook.invalid/docs/handbook/`,G=Object.assign({"../../../docs/handbook/README.md":u,"../../../docs/handbook/admin.md":d,"../../../docs/handbook/annotator.md":ee,"../../../docs/handbook/consolidator.md":te,"../../../docs/handbook/faq.md":ne,"../../../docs/handbook/first-task.md":f,"../../../docs/handbook/getting-started.md":p,"../../../docs/handbook/lead-change-course.md":m,"../../../docs/handbook/lead-documents.md":h,"../../../docs/handbook/lead-results.md":g,"../../../docs/handbook/lead-settings.md":_,"../../../docs/handbook/lead.md":v}),K=Object.assign({"../../../docs/handbook/images/admin-new-project.png":y,"../../../docs/handbook/images/admin-setup-code.png":b,"../../../docs/handbook/images/annotator-carried-finding.png":x,"../../../docs/handbook/images/annotator-editor.png":S,"../../../docs/handbook/images/annotator-finding-values.png":C,"../../../docs/handbook/images/annotator-new-finding.png":w,"../../../docs/handbook/images/annotator-proposal-review.png":T,"../../../docs/handbook/images/annotator-submit-dialog.png":E,"../../../docs/handbook/images/annotator-translation-review.png":D,"../../../docs/handbook/images/consolidator-group-table.png":O,"../../../docs/handbook/images/consolidator-submit-dialog.png":k,"../../../docs/handbook/images/getting-started-my-tasks.png":A,"../../../docs/handbook/images/getting-started-set-password.png":j,"../../../docs/handbook/images/getting-started-user-menu.png":M,"../../../docs/handbook/images/lead-assign.png":N,"../../../docs/handbook/images/lead-compare-results.png":P,"../../../docs/handbook/images/lead-documents.png":F,"../../../docs/handbook/images/lead-export.png":re,"../../../docs/handbook/images/lead-move-release-check.png":I,"../../../docs/handbook/images/lead-problem-report.png":L,"../../../docs/handbook/images/lead-progress.png":R,"../../../docs/handbook/images/lead-text-card.png":z,"../../../docs/handbook/images/lead-upload-preview.png":B,"../../../docs/handbook/images/lead-work-plan.png":V,"../../../docs/handbook/images/workflow.png":H}),q=e=>e.slice(e.lastIndexOf(`/`)+1),J=Object.fromEntries(Object.entries(G).map(([e,t])=>[q(e).replace(/\.md$/,``),t])),Y=Object.fromEntries(Object.entries(K).map(([e,t])=>[`images/${q(e)}`,t]));function X(e){var t;return((t=/^# +(.+)$/m.exec(J[e]??``))==null?void 0:t[1].trim())??e}function ie(){let e=[...(J.README??``).matchAll(/\]\(([A-Za-z0-9_-]+)\.md[)#]/g)].map(e=>e[1]);return[...new Set([`README`,...e,...Object.keys(J).sort()])].filter(e=>e in J)}function ae(e){return e.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu,``).replace(/ /g,`-`)}function oe(){let e=new Map;return t=>{let n=ae(t),r=n;for(;e.has(r);){let t=e.get(n)+1;e.set(n,t),r=`${n}-${t}`}return e.set(r,0),r}}function se(e,t){var n;if(/^[a-z][a-z0-9+.-]*:/i.test(e))return{kind:`external`,href:e};let r=new URL(e,`${W}${t}.md`),a=decodeURIComponent(r.hash.slice(1)),o=(n=/^\/docs\/handbook\/([A-Za-z0-9_-]+)\.md$/.exec(r.pathname))==null?void 0:n[1];return o&&o in J?o===t&&a?{kind:`anchor`,id:a}:{kind:`chapter`,href:i({name:`help`,chapter:o,...a?{section:a}:{}})}:{kind:`external`,href:`${U}${r.pathname}${r.hash}`}}function ce(e,t){return/^[a-z][a-z0-9+.-]*:/i.test(e)?null:Y[new URL(e,`${W}${t}.md`).pathname.replace(/^\/docs\/handbook\//,``)]??null}var Z=e=>e.type===`text`?e.value:`children`in e?e.children.map(Z).join(``):``;function le(){return e=>{let t=oe(),n=e=>e.children.forEach(e=>{e.type===`element`&&(/^h[1-6]$/.test(e.tagName)?e.properties.id=t(Z(e)):n(e))});n(e)}}function Q(e){var t;(t=document.getElementById(e))==null||t.scrollIntoView()}var $=e=>e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey;function ue(e){return{a:({href:t,children:n})=>{if(!t)return(0,c.jsx)(c.Fragment,{children:n});let r=se(t,e);return r.kind===`external`?(0,c.jsx)(`a`,{href:r.href,target:`_blank`,rel:`noopener noreferrer`,children:n}):r.kind===`chapter`?(0,c.jsx)(`a`,{href:r.href,children:n}):(0,c.jsx)(`a`,{href:i({name:`help`,chapter:e,section:r.id}),onClick:e=>{$(e)&&(e.preventDefault(),Q(r.id))},children:n})},img:({src:t,alt:n})=>{let r=t?ce(t,e):null;return r?(0,c.jsx)(`a`,{className:`help-image-link`,href:r,target:`_blank`,rel:`noopener noreferrer`,title:`Open the image at full size in a new tab`,children:(0,c.jsx)(`img`,{className:`help-image`,src:r,alt:n??``,loading:`lazy`})}):(0,c.jsx)(`span`,{className:`guideline-image-text`,children:n?`Image: ${n}`:`Image`})},table:({children:e})=>(0,c.jsx)(`div`,{className:`guideline-table-scroll`,tabIndex:0,role:`region`,"aria-label":`Table`,children:(0,c.jsx)(`table`,{children:e})})}}function de({chapter:e=`README`,section:t}){let n=J[e];return(0,s.useEffect)(()=>{var e,n;t?Q(t):(e=document.getElementById(`main`))==null||(n=e.scrollTo)==null||n.call(e,0,0)},[e,t]),(0,c.jsxs)(`div`,{className:`help-page`,children:[(0,c.jsxs)(`nav`,{className:`help-chapters`,"aria-label":`Handbook chapters`,children:[(0,c.jsx)(`ul`,{children:ie().map(t=>(0,c.jsx)(`li`,{children:(0,c.jsx)(`a`,{href:i({name:`help`,chapter:t}),"aria-current":t===e?`page`:void 0,children:X(t)})},t))}),(0,c.jsx)(l,{})]}),(0,c.jsx)(`article`,{className:`guideline-document help-document`,children:n===void 0?(0,c.jsxs)(c.Fragment,{children:[(0,c.jsx)(`h1`,{children:`Chapter not found`}),(0,c.jsxs)(`p`,{children:[`This handbook has no chapter “`,e,`”. Pick one from the list.`]})]}):(0,c.jsx)(`div`,{className:`guideline-markdown`,children:(0,c.jsx)(a,{remarkPlugins:[o],rehypePlugins:[le],skipHtml:!0,components:ue(e),children:n})})})]})}export{de as default};