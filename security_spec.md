# Security Specification - Rubi's Tennis Store

## Data Invariants
1. `SiteContent` is a singleton located at `/settings/content`. It can only be read by anyone but written only by the admin.
2. `Leads` can be created by any user (even unauthenticated) but can only be read/listed/updated/deleted by the admin.
3. The Admin is defined as the user with email `rubizach@gmail.com` and must have a verified email.

## The "Dirty Dozen" Payloads (Denial Tests)
1. **Unauthorized Content Update**: Attempt to update `/settings/content` as a guest.
2. **Unauthorized Lead Read**: Attempt to list `/leads` as a guest.
3. **Identity Spoofing in Admin Check**: Attempt to write as admin with a spoofed email (unverified).
4. **Lead Deletion by Guest**: Attempt to delete a lead from `/leads/xyz` as a guest.
5. **Content Poisoning**: Attempt to write 2MB string into `siteName`.
6. **Malicious Document ID**: Attempt to create a lead with an ID like `../../../etc/passwd`.
7. **Invalid Field Type**: Attempt to write a number into `SiteContent.siteName`.
8. **Missing Required Fields**: Attempt to create a lead without a `name`.
9. **Shadow Field Injection**: Attempt to add an `isAdmin: true` field to a lead document.
10. **Terminal State Bypass**: (N/A for this simple lead system, but included in spirit)
11. **PII Blanket Leak**: Attempt to `get` a specific lead by its ID as a non-admin.
12. **Recursive Cost Attack**: Large list query on `/leads` without filters or admin auth.

## admin email: rubizach@gmail.com
