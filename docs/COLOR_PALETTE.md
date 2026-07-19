# UI Component Color Palette

This document defines the core color system used across the UI components utilizing HSL values and CSS variables to seamlessly handle light and dark modes.

## 1. Primary Colors

Used for main actions, active states, and primary branding.

| CSS Variable           | Light Mode (HSL)    | Dark Mode Override (HSL) | Usage Context                                |
| :--------------------- | :------------------ | :----------------------- | :------------------------------------------- |
| `--primary`            | `222.2 47.4% 11.2%` | `210 40% 98%`            | Main buttons, active navigation links        |
| `--primary-foreground` | `210 40% 98%`       | `222.2 47.4% 11.2%`      | Text/icons placed on top of primary elements |

## 2. Secondary Colors

Used for secondary actions, muted backgrounds, and subtle borders.

| CSS Variable             | Light Mode (HSL)    | Dark Mode Override (HSL) | Usage Context                       |
| :----------------------- | :------------------ | :----------------------- | :---------------------------------- |
| `--secondary`            | `210 40% 96.1%`     | `217.2 32.6% 17.5%`      | Secondary buttons, card backgrounds |
| `--secondary-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%`            | Text on secondary backgrounds       |

## 3. Semantic Colors

Used to communicate status to the user.

| CSS Variable    | Light Mode (HSL)    | Dark Mode Override (HSL) | Usage Context                                     |
| :-------------- | :------------------ | :----------------------- | :------------------------------------------------ |
| `--destructive` | `0 84.2% 60.2%`     | `0 62.8% 30.6%`          | Delete buttons, error messages, validation alerts |
| `--success`     | `142.1 76.2% 36.3%` | `149 65% 25%`            | Success toasts, completion indicators             |

## 4. Glassmorphism Surface Colors

Translucent colors used for floating elements that require a blurred backdrop effect.

| CSS Variable      | Light Mode (HSL)          | Dark Mode Override (HSL)  | Usage Context                   |
| :---------------- | :------------------------ | :------------------------ | :------------------------------ |
| `--glass-surface` | `0 0% 100% / 0.7`         | `222.2 84% 4.9% / 0.7`    | Modal backdrops, sticky navbars |
| `--glass-border`  | `214.3 31.8% 91.4% / 0.4` | `217.2 32.6% 17.5% / 0.4` | Borders for glassmorphism cards |
