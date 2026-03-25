# Feedback Issue Authoring Instructions

You are creating a GitHub issue from user feedback for RunMaestro.

User-provided feedback:
{{FEEDBACK}}

Attached screenshots prepared for direct inclusion in the GitHub issue body (if any).
When this section is not `None`, it contains literal markdown image lines that must be copied unchanged:
{{ATTACHMENT_CONTEXT}}

Do not ask for clarification. Use the text as-is and proceed.

1. Classify feedback type as one of:

- Bug report
- Feature request
- Improvement
- General feedback

2. Write a concise GitHub issue title prefixed with the type, e.g., "Bug: ...".

3. Write issue body with these sections:

- Description
- Expected vs Current Behavior
- Steps to Reproduce (for bug reports; if unavailable, clearly note "Not provided")
- Proposed Solution (for feature/improvement items)
- Impact and Priority (brief)

4. Ensure the `Maestro-feedback` label exists.
   First check whether it already exists.
   Only create it if it is missing.

5. If the attachment context is not `None`, you MUST add a `## Screenshots` section to the issue body
   and paste the provided markdown image lines exactly as given.
   Do not alter the alt text, URLs, or markdown formatting.

6. Then run:
   Try to create the issue with the `Maestro-feedback` label.
   If label creation or issue labeling fails because of permissions, create the issue without the label instead of stopping.

7. Reply with only the created issue URL.
