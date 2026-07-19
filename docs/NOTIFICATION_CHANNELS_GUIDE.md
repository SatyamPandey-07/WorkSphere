# Notification Channels Setup & Settings Guide

This document outlines the setup, architecture, and configuration of user notification settings in WorkSphere.

---

## Supported Channels

WorkSphere supports three main notification channels:
1. **In-App Notifications**: Displayed dynamically in the user's dashboard (bell icon).
2. **Telegram Alerts**: Push updates sent via a Telegram bot directly to the user's chat.
3. **WhatsApp Messages**: Operational alerts triggered through Twilio or webhook configurations.

---

## Configuration Settings UI

The user dashboard settings allows enabling or disabling individual channels:
- **Telegram Webhook**: The URL of your Telegram bot sync channel.
- **WhatsApp Webhook**: The URL of your WhatsApp message gateway.
- **Timezone**: Configures correct timing matching your geographical region.

---

## Customizing Avatar

You can upload a custom avatar, crop it to a circular shape, and save it. Avatars are hosted securely on Clerk/Cloudinary.
