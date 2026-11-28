# WorkSphere Tailwind/CSS Tokens to Flutter ThemeData & ColorScheme Mapping

Maps WorkSphere's Tailwind/CSS color tokens, typography scale, and WCAG AAA high-contrast mode to Flutter `ThemeData`, `ColorScheme`, and `TextTheme`.

## 1. Light Mode Tokens

| Role | CSS Token | Hex | Flutter Slot |
| :--- | :--- | :--- | :--- |
| Primary | `--ws-primary` | `#4F46E5` | `ColorScheme.primary` |
| On Primary | `--ws-on-primary` | `#FFFFFF` | `ColorScheme.onPrimary` |
| Secondary | `--ws-secondary` | `#0891B2` | `ColorScheme.secondary` |
| Surface | `--ws-bg` | `#F8FAFC` | `ColorScheme.surface` |
| On Surface | `--ws-text-primary` | `#0F172A` | `ColorScheme.onSurface` |
| Error | `--ws-error` | `#B91C1C` | `ColorScheme.error` |

## 2. Dark Mode Tokens

| Role | CSS Token | Hex | Flutter Slot |
| :--- | :--- | :--- | :--- |
| Primary | `--ws-dark-primary` | `#A5B4FC` | `ColorScheme.primary` |
| On Primary | `--ws-dark-on-primary` | `#1E1B4B` | `ColorScheme.onPrimary` |
| Secondary | `--ws-dark-secondary` | `#67E8F9` | `ColorScheme.secondary` |
| Surface | `--ws-dark-bg` | `#090D16` | `ColorScheme.surface` |
| On Surface | `--ws-dark-text-primary` | `#F8FAFC` | `ColorScheme.onSurface` |
| Error | `--ws-dark-error` | `#F87171` | `ColorScheme.error` |

## 3. WCAG AAA High-Contrast Mode Tokens

| Role | CSS Token | Hex (Light AAA / Dark AAA) | Flutter Slot |
| :--- | :--- | :--- | :--- |
| Primary | `--ws-aaa-primary` | `#1D1B84` / `#C7D2FE` | `ColorScheme.primary` |
| On Primary | `--ws-aaa-on-primary` | `#FFFFFF` / `#000000` | `ColorScheme.onPrimary` |
| Secondary | `--ws-aaa-secondary` | `#064E63` / `#A5F3FC` | `ColorScheme.secondary` |
| Surface | `--ws-aaa-bg` | `#FFFFFF` / `#000000` | `ColorScheme.surface` |
| On Surface | `--ws-aaa-text-primary` | `#000000` / `#FFFFFF` | `ColorScheme.onSurface` |
| Error | `--ws-aaa-error` | `#7F1D1D` / `#FCA5A5` | `ColorScheme.error` |

## 4. Typography & TextTheme Scale

| Tailwind Scale | Size | Line Height | Flutter `TextTheme` Role |
| :--- | :--- | :--- | :--- |
| `text-sm` | `14px` | `1.43` | `bodyMedium` / `labelLarge` |
| `text-base` | `16px` | `1.50` | `bodyLarge` |
| `text-lg` | `18px` | `1.44` | `titleMedium` |
| `text-xl` | `20px` | `1.40` | `titleLarge` |
| `text-2xl` | `24px` | `1.33` | `headlineSmall` |
