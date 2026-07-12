# Security Policies

## Overview

Security is an important part of building and maintaining WorkSphere. This guide outlines recommended practices for handling user-generated content safely, protecting API endpoints, and reducing common web security risks.

While these guidelines are not tied to a specific implementation, they should be considered whenever new forms, APIs, or content rendering features are added to the project.

The main objectives of this document are to:

- Reduce the risk of Cross-Site Scripting (XSS) attacks.
- Encourage proper input validation and sanitization.
- Provide guidance for safely rendering Markdown content.
- Recommend secure CORS configurations for API endpoints.
- Promote consistent security practices across future contributions.

---

# Input Sanitization

All data received from users should be treated as untrusted until it has been validated.

Typical sources of user input include:

- Venue submissions
- Reviews and comments
- Contact forms
- Profile information
- Search queries

## Recommended Practices

Whenever user input is processed:

- Validate data on both the client and the server.
- Reject or sanitize unexpected HTML content.
- Escape special characters before displaying user-generated text.
- Apply sensible length limits to text fields.
- Reject malformed or invalid requests early.

Client-side validation improves the user experience, but server-side validation should always be considered the final layer of protection.

---

# Preventing Script Injection

Applications should never execute JavaScript that originates from user input.

For example, content like the following should never be rendered directly:

```html
<script>alert("XSS")</script>
```

```html
<img src="x" onerror="alert('XSS')">
```

When processing content such as venue descriptions or reviews:

- Remove `<script>` elements.
- Ignore inline event handlers such as `onclick`, `onload`, and `onerror`.
- Reject unsafe HTML attributes unless they are explicitly supported.
- Prefer plain text when rich formatting is unnecessary.

If HTML support is introduced in the future, use a well-maintained sanitization library instead of implementing custom filtering logic.

---

# Markdown Validation

Markdown can improve readability, but it should still be handled carefully before rendering.

Recommended practices include:

- Support standard Markdown syntax only.
- Escape or remove embedded HTML.
- Prevent inline JavaScript from being rendered.
- Restrict unsupported HTML tags.
- Sanitize the generated HTML before displaying it.

Typical Markdown features that are safe to support include:

- Headings
- Lists
- Links
- Bold and italic formatting
- Code blocks

If future features require HTML rendering alongside Markdown, ensure that the generated output is sanitized before it reaches the UI.

### Example

Unsafe Markdown input:

```md
Click here <script>alert("XSS")</script>
```

The rendered output should preserve valid Markdown while preventing executable HTML or JavaScript from being rendered.
---

# Cross-Site Scripting (XSS) Prevention

Cross-Site Scripting (XSS) is one of the most common web security vulnerabilities. It happens when untrusted input is treated as executable code in the browser.

To reduce the risk of XSS:

- Treat every piece of user-generated content as untrusted.
- Escape user input before displaying it in the interface.
- Never execute JavaScript provided by users.
- Avoid rendering raw HTML unless it has been properly sanitized.
- Prefer React's built-in escaping instead of bypassing it with custom rendering logic.

If rich-text features are added in the future, ensure that any generated HTML is sanitized before it is rendered.

---

# CORS Configuration

Cross-Origin Resource Sharing (CORS) defines which external origins are allowed to access the application's API endpoints.

A secure CORS configuration should:

- Allow requests only from trusted origins.
- Expose only the HTTP methods required by each endpoint.
- Limit accepted request headers to the minimum necessary.
- Avoid using wildcard (`*`) origins for authenticated APIs.
- Enable credentials only when they are actually needed.

A typical configuration might look like this:

| Setting | Recommendation |
| -------- | -------------- |
| Allowed Origins | Trusted application domains only |
| Allowed Methods | GET, POST, PUT, PATCH, DELETE (as required) |
| Allowed Headers | Content-Type, Authorization |
| Credentials | Enable only when required |

Whenever a new API endpoint is introduced, review its CORS configuration before deployment.

Additional recommendations:

- Return only the headers required by the client.
- Reject requests from unknown origins whenever possible.
- Review CORS policies whenever a new public API endpoint is introduced.
- Enable credentials only for trusted origins that require authenticated requests.

---

# General Security Best Practices

Security should be part of the development process rather than something added at the end.

Some general recommendations include:

- Validate all incoming request data.
- Perform server-side validation even if client-side validation already exists.
- Keep project dependencies updated with the latest security patches.
- Never commit secrets or API keys to the repository.
- Store sensitive configuration in environment variables.
- Avoid exposing confidential information in logs or error messages.
- Review third-party dependencies before introducing them into the project.

Following these practices helps reduce common security risks and keeps the project easier to maintain over time.

---

# Common Security Mistakes

When contributing to WorkSphere, avoid the following practices:

- Rendering untrusted HTML directly.
- Accepting user input without server-side validation.
- Allowing unrestricted Markdown or HTML rendering.
- Using wildcard (`*`) CORS policies for authenticated endpoints.
- Logging secrets, tokens, or sensitive user information.
- Trusting client-side validation as the only validation layer.

Review security-sensitive changes carefully before opening a pull request.

# Developer Checklist

Before opening a pull request, make sure that:

- [ ] User input is validated.
- [ ] Sensitive information is not exposed in logs.
- [ ] HTML rendering is handled safely.
- [ ] API endpoints follow the project's CORS guidelines.
- [ ] Secrets are stored in environment variables.
- [ ] New dependencies have been reviewed.
- [ ] Documentation has been updated if security-related behavior has changed.

---

# Security Review Checklist

Before merging security-related changes, verify that:

- User input is validated on the server.
- HTML output is sanitized before rendering.
- Markdown rendering cannot execute scripts.
- API endpoints expose only the required origins.
- Secrets are stored securely and never committed to the repository.
- Error messages do not expose sensitive implementation details.

# References

Useful resources for learning more about web application security:

- OWASP Cross-Site Scripting (XSS) Prevention Cheat Sheet
- OWASP Input Validation Cheat Sheet
- MDN Web Docs – Cross-Origin Resource Sharing (CORS)
- React Documentation – Security Considerations
