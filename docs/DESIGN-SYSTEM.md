# closeVDS Design System Specification

## 1. Core Visual Theme

The official closeVDS visual system is strictly **Monochrome (Black & White)**. 

The UI must present a stark, high-contrast, state-of-the-art aesthetic that wows users with its spatial rhythm, precise typography, subtle micro-interactions, and pristine layout.

## 2. Design Tokens

### Core Brand Tokens
```css
:root {
  --color-black: #000000;
  --color-white: #FFFFFF;

  /* Neutral Scale */
  --neutral-950: #0A0A0A;
  --neutral-900: #171717;
  --neutral-700: #404040;
  --neutral-500: #737373;
  --neutral-300: #D4D4D4;
  --neutral-200: #E5E5E5;
  --neutral-100: #F5F5F5;
  --neutral-50:  #FAFAFA;
}
```

### Contextual UI Mapping (Dark Mode Default)
- **Application Canvas Background**: `#000000` / `#0A0A0A`
- **Surface / Card Background**: `#171717`
- **Primary Text**: `#FFFFFF`
- **Secondary / Muted Text**: `#737373`
- **Borders & Separators**: `#404040` (1px solid)
- **Primary Button**: Background `#FFFFFF`, Text `#000000` (Hover: opacity 0.9 / `#E5E5E5`)
- **Secondary Button**: Background `#171717`, Border `#404040`, Text `#FFFFFF`
- **Focus Rings**: `#FFFFFF` (2px offset)

## 3. Typography & Hierarchy

### Font Family
Primary UI fonts (Google Fonts / Geist / Inter / Satoshi):
```css
font-family: 'Geist', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
```

### Scale & Weight Rules
- **Display Headings (`h1`)**: 32px / 2rem, Weight 700, Line-height 1.2, Letter-spacing -0.02em
- **Section Titles (`h2`)**: 24px / 1.5rem, Weight 600, Line-height 1.3, Letter-spacing -0.01em
- **Card / Subsection Headings (`h3`)**: 18px / 1.125rem, Weight 600, Line-height 1.4
- **Body Text**: 14px / 0.875rem, Weight 400, Line-height 1.5, Text `#FFFFFF` or `#FAFAFA`
- **Caption / Meta Text**: 12px / 0.75rem, Weight 400, Text `#737373`
- **Code / Monospace**: 'JetBrains Mono', 'Fira Code', monospace

## 4. UI Components & Layout Rules

### Surface Elevation & Borders
- Avoid heavy drop shadows. Use subtle 1px `#404040` borders for card definitions.
- Cards use `#171717` background with clean 8px border radius (`border-radius: 8px`).

### Data Tables & Lists
- Table headers: `#0A0A0A` background, uppercase 11px text `#737373`, weight 600.
- Table rows: `#171717` background, 1px bottom border `#404040`, hover highlight `#262626`.
- Metric numbers: High-contrast white `#FFFFFF`, tabular numbers (`font-variant-numeric: tabular-nums`).

### Buttons & Controls
- Primary Action: Solid White fill (`#FFFFFF`), solid Black text (`#000000`), rounded-md.
- Secondary Action: Solid `#171717`, 1px border `#404040`, White text (`#FFFFFF`).
- Destructive Action / Kill Switch: High-contrast outlined white/neutral with explicit confirmation modal.

## 5. Explicitly Prohibited Aesthetics

- **NO** Primary Purple or Blue branding.
- **NO** Rainbow, sunset, or vibrant color gradients.
- **NO** Heavy glassmorphism blur overflow or excessive glow filters.
- **NO** Gaming/Cyberpunk neon aesthetic.
- **NO** Decorative industry icons (teeth, houses, cars).
- **NO** Skewed or low-contrast text that compromises accessibility.
