---
name: TypeMind Design System
colors:
  surface: '#fcf9f6'
  surface-dim: '#dcdad7'
  surface-bright: '#fcf9f6'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f0'
  surface-container: '#f0edea'
  surface-container-high: '#eae8e5'
  surface-container-highest: '#e5e2df'
  on-surface: '#1b1c1a'
  on-surface-variant: '#4b463f'
  inverse-surface: '#31302f'
  inverse-on-surface: '#f3f0ed'
  outline: '#7c766e'
  outline-variant: '#cdc5bc'
  surface-tint: '#635e56'
  primary: '#15110c'
  on-primary: '#ffffff'
  primary-container: '#2a2620'
  on-primary-container: '#938d84'
  inverse-primary: '#cdc5bc'
  secondary: '#655e50'
  on-secondary: '#ffffff'
  secondary-container: '#ece1cf'
  on-secondary-container: '#6b6455'
  tertiary: '#1a1000'
  on-tertiary: '#ffffff'
  tertiary-container: '#352300'
  on-tertiary-container: '#a78955'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#eae1d8'
  primary-fixed-dim: '#cdc5bc'
  on-primary-fixed: '#1f1b15'
  on-primary-fixed-variant: '#4b463f'
  secondary-fixed: '#ece1cf'
  secondary-fixed-dim: '#cfc5b4'
  on-secondary-fixed: '#201b10'
  on-secondary-fixed-variant: '#4c4639'
  tertiary-fixed: '#ffdea8'
  tertiary-fixed-dim: '#e4c289'
  on-tertiary-fixed: '#271900'
  on-tertiary-fixed-variant: '#5a4316'
  background: '#fcf9f6'
  on-background: '#1b1c1a'
  surface-variant: '#e5e2df'
  dark-charcoal: '#2A2620'
  warm-brown: '#665F51'
  warm-gold: '#7A6030'
  sage-green: '#3D5C3E'
  dusty-red: '#7A3F3F'
  off-white: '#FCF9F6'
  light-gray: '#F1EDEA'
  medium-gray: '#C9C5C1'
  muted-taupe: '#7B7771'
  border-light: '#DCD9D7'
  dust-tan: '#D9D1C0'
  button-hover: '#3D3830'
typography:
  display-h1:
    fontFamily: Newsreader
    fontSize: 72px
    fontWeight: '700'
    lineHeight: 79.2px
  heading-h2:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
  heading-h3:
    fontFamily: Newsreader
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 33.6px
  body-lg:
    fontFamily: Newsreader
    fontSize: 17.6px
    fontWeight: '400'
    lineHeight: 29.92px
  body-reg:
    fontFamily: Newsreader
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-emphasis:
    fontFamily: Newsreader
    fontSize: 17.6px
    fontWeight: '700'
    lineHeight: 26.4px
  button-lg:
    fontFamily: Newsreader
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  button-sm:
    fontFamily: Newsreader
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 21px
  caption:
    fontFamily: Newsreader
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  huge: 64px
  giant: 80px
---

# Design System Inspired by TypeMind
## 1. Visual Theme & Atmosphere
TypeMind's design system embodies a refined, minimalist aesthetic rooted in warm, earthy tones and generous whitespace. The visual language is sophisticated yet approachable, balancing a calm, neutral foundation with strategic moments of warmth through muted earth-tone accents. Typography plays a starring role, with the serif font Newsreader lending gravitas and readability to instructional content. The overall mood is focused and instructional—designed to reduce cognitive load during typing practice while maintaining an air of professionalism and care. Subtle shadows and soft transitions create gentle depth without distraction, prioritizing clarity and the user's typing performance metrics.
**Key Characteristics**
- Warm neutral palette with earthy brown and sage accents
- Generous spacing and breathing room throughout layouts
- Serif typography (Newsreader) for elegance and readability
- Minimal, purposeful elevation using soft shadows
- Clear hierarchy emphasizing instructional content over decoration
- Calming, distraction-free interface supporting focus and learning
## 2. Color Palette & Roles
### Primary
- **Dark Charcoal** (`#2A2620`): Primary text, headings, and dominant UI elements; establishes hierarchy and readability
- **Warm Brown** (`#665F51`): Secondary interactive elements, accents, and button backgrounds; creates warmth without distraction
### Accent Colors
- **Dusty Red** (`#7A3F3F`): Subtle accent for errors or warning states when needed
- **Sage Green** (`#3D5C3E`): Alternative accent for positive actions or success states
- **Warm Gold** (`#7A6030`): Tertiary accent for informational highlights or secondary CTAs
### Interactive
- **Button Primary** (`#665F51`): Primary call-to-action buttons, form submit actions
- **Button Hover** (`#3D3830`): Darkened state on hover for primary buttons
### Neutral Scale
- **Off-White Primary** (`#FCF9F6`): Main background color for full pages
- **Light Gray** (`#F1EDEA`): Secondary background, card backgrounds, subtle container fills
- **Lighter Gray** (`#F6F3F1`): Tertiary background for nested components
- **Medium-Light Gray** (`#E5E2DF`): Dividers, borders, and subtle separators
- **Medium Gray** (`#C9C5C1`): Secondary text, metadata, hints, and disabled states
- **Muted Taupe** (`#7B7771`): Tertiary text and caption text in reduced emphasis
### Surface & Borders
- **Border Light** (`#DCD9D7`): Subtle borders on containers and cards
- **Dust Tan** (`#D9D1C0`): Card borders, subtle divides between sections
- **Pure White** (`#FFFFFF`): Overlay backgrounds, modal overlays, card surfaces in elevated states
## 3. Typography Rules
### Font Family
**Primary Font:** Newsreader (serif) with fallbacks: `Georgia, serif`
**Secondary Font:** Newsreader (serif) for all text; no secondary sans-serif defined in system
### Hierarchy
| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|-----------------|-------|
| Display/H1 | Newsreader | 72px | 700 | 79.2px | 0px | Hero headlines, page titles; maximum visual impact |
| Heading/H2 | Newsreader | 40px | 700 | 48px | 0px | Section headers, feature titles |
| Heading/H3 | Newsreader | 28px | 700 | 33.6px | 0px | Subsection headers, card titles |
| Body/Large | Newsreader | 17.6px | 400 | 29.92px | 0px | Primary body copy, main content paragraphs |
| Body/Regular | Newsreader | 16px | 400 | 24px | 0px | Standard body text, descriptions |
| Body/Emphasis | Newsreader | 17.6px | 700 | 26.4px | 0px | Highlighted text, emphasis within body |
| Button/Large | Newsreader | 16px | 600 | 24px | 0px | Large CTA buttons (52px height) |
| Button/Small | Newsreader | 14px | 600 | 21px | 0px | Small buttons, secondary actions (33px height) |
| Caption | Newsreader | 12px | 400 | 18px | 0px | Metadata, helper text, labels, timestamps |
| Navigation | Newsreader | 16px | 400 | 24px | 0px | Top navigation, menu items |
### Principles
- **Single typeface system:** Newsreader serif used exclusively for consistency and elegance
- **Weight contrast:** 400 for body, 600 for buttons/emphasis, 700 for headings creates clear hierarchy
- **Generosity with line height:** 1.4x–1.6x base size allows comfortable reading and reduces fatigue during instruction
- **Size scale based on modular increments:** Supports responsive scaling without breaking proportions
- **No letter spacing adjustments** in primary system; preserved at 0px for natural reading rhythm
## 4. Component Stylings
### Buttons
#### Primary Button (Large)
- **Background:** `#665F51`
- **Text Color:** `#FFFFFF`
- **Font Size:** `16px`
- **Font Weight:** `600`
- **Line Height:** `24px`
- **Padding:** `14px 36px`
- **Border Radius:** `8px`
- **Border:** `0px solid transparent`
- **Box Shadow:** `none`
- **Height:** `52px`
- **Hover State:**
  - **Background:** `#3D3830`
  - **Cursor:** `pointer`
  - **Transition:** `background-color 200ms ease`
- **Active State:**
  - **Background:** `#2A2620`
  - **Transform:** `scale(0.98)`
- **Disabled State:**
  - **Background:** `#C9C5C1`
  - **Color:** `#7B7771`
  - **Cursor:** `not-allowed`
  - **Opacity:** `0.6`
#### Primary Button (Small)
- **Background:** `#665F51`
- **Text Color:** `#FFFFFF`
- **Font Size:** `14px`
- **Font Weight:** `600`
- **Line Height:** `21px`
- **Padding:** `6px 16px`
- **Border Radius:** `6px`
- **Border:** `0px solid transparent`
- **Box Shadow:** `none`
- **Height:** `33px`
- **Hover State:**
  - **Background:** `#3D3830`
  - **Cursor:** `pointer`
  - **Transition:** `background-color 200ms ease`
- **Active State:**
  - **Background:** `#2A2620`
#### Secondary Button
- **Background:** `#F1EDEA`
- **Text Color:** `#2A2620`
- **Font Size:** `16px`
- **Font Weight:** `600`
- **Line Height:** `24px`
- **Padding:** `14px 36px`
- **Border Radius:** `8px`
- **Border:** `1px solid #DCD9D7`
- **Box Shadow:** `none`
- **Hover State:**
  - **Background:** `#E5E2DF`
  - **Border Color:** `#C9C5C1`
  - **Transition:** `all 200ms ease`
- **Active State:**
  - **Background:** `#D9D1C0`
#### Ghost Button
- **Background:** `transparent`
- **Text Color:** `#2A2620`
- **Font Size:** `16px`
- **Font Weight:** `600`
- **Line Height:** `24px`
- **Padding:** `14px 36px`
- **Border Radius:** `8px`
- **Border:** `1px solid #C9C5C1`
- **Box Shadow:** `none`
- **Hover State:**
  - **Background:** `#FCF9F6`
  - **Border Color:** `#665F51`
  - **Transition:** `all 200ms ease`
### Cards & Containers
#### Feature Card
- **Background:** `#FFFFFF`
- **Border:** `1px solid #DCD9D7`
- **Border Radius:** `8px`
- **Padding:** `24px`
- **Box Shadow:** `rgba(40, 34, 24, 0.06) 0px 1px 3px 0px`
- **Title:**
  - **Font Size:** `18px`
  - **Font Weight:** `700`
  - **Color:** `#2A2620`
  - **Margin Bottom:** `12px`
- **Body Text:**
  - **Font Size:** `16px`
  - **Font Weight:** `400`
  - **Color:** `#7B7771`
  - **Line Height:** `24px`
- **Hover State:**
  - **Box Shadow:** `rgba(40, 34, 24, 0.07) 0px 2px 8px 0px`
  - **Border Color:** `#C9C5C1`
  - **Transition:** `all 200ms ease`
#### Elevated Card
- **Background:** `#FCF9F6`
- **Border:** `1px solid #E5E2DF`
- **Border Radius:** `8px`
- **Padding:** `28px 32px`
- **Box Shadow:** `rgba(40, 34, 24, 0.07) 0px 2px 8px 0px`
#### Lesson Container
- **Background:** `#FFFFFF`
- **Border:** `1px solid #DCD9D7`
- **Border Radius:** `12px`
- **Padding:** `36px 40px`
- **Box Shadow:** `rgba(40, 34, 24, 0.06) 0px 1px 3px 0px`
- **Lesson Text:**
  - **Font Size:** `16px`
  - **Font Weight:** `400`
  - **Color:** `#2A2620`
  - **Line Height:** `24px`
### Inputs & Forms
#### Text Input
- **Background:** `#FFFFFF`
- **Border:** `1px solid #DCD9D7`
- **Border Radius:** `6px`
- **Padding:** `10px 12px`
- **Font Size:** `16px`
- **Font Weight:** `400`
- **Color:** `#2A2620`
- **Line Height:** `24px`
- **Focus State:**
  - **Border Color:** `#665F51`
  - **Box Shadow:** `0px 0px 0px 3px rgba(102, 95, 81, 0.1)`
  - **Outline:** `none`
- **Error State:**
  - **Border Color:** `#7A3F3F`
  - **Background:** `rgba(122, 63, 63, 0.05)`
- **Disabled State:**
  - **Background:** `#F1EDEA`
  - **Border Color:** `#DCD9D7`
  - **Color:** `#C9C5C1`
  - **Cursor:** `not-allowed`
#### Input Label
- **Font Size:** `14px`
- **Font Weight:** `600`
- **Color:** `#2A2620`
- **Margin Bottom:** `6px`
- **Display:** `block`
#### Helper Text
- **Font Size:** `12px`
- **Font Weight:** `400`
- **Color:** `#7B7771`
- **Margin Top:** `4px`
### Navigation
#### Header Navigation
- **Background:** `#FCF9F6`
- **Height:** `56px`
- **Padding:** `0px 40px`
- **Border Bottom:** `1px solid #E5E2DF`
- **Display:** `flex`
- **Align Items:** `center`
- **Justify Content:** `space-between`
- **Box Shadow:** `none`
#### Logo
- **Font Size:** `18px`
- **Font Weight:** `700`
- **Color:** `#2A2620`
#### Nav Item
- **Font Size:** `16px`
- **Font Weight:** `400`
- **Color:** `#2A2620`
- **Padding:** `8px 16px`
- **Margin Left:** `16px`
- **Border Radius:** `4px`
- **Transition:** `all 200ms ease`
- **Hover State:**
  - **Background:** `#F1EDEA`
  - **Color:** `#665F51`
#### Active Nav Item
- **Color:** `#665F51`
- **Font Weight:** `600`
- **Border Bottom:** `2px solid #665F51`
### Badges & Metrics
#### Metric Badge
- **Background:** `#F1EDEA`
- **Border:** `1px solid #DCD9D7`
- **Border Radius:** `6px`
- **Padding:** `6px 12px`
- **Font Size:** `12px`
- **Font Weight:** `600`
- **Color:** `#2A2620`
- **Display:** `inline-block`
#### Accuracy Badge
- **Background:** `rgba(61, 92, 62, 0.1)`
- **Color:** `#3D5C3E`
- **Border:** `1px solid #3D5C3E`
#### Error Badge
- **Background:** `rgba(122, 63, 63, 0.1)`
- **Color:** `#7A3F3F`
- **Border:** `1px solid #7A3F3F`
## 5. Layout Principles
### Spacing System
**Base Unit:** `4px`
**Scale:** `8px, 12px, 16px, 20px, 24px, 28px, 32px, 36px, 40px, 48px, 64px, 80px`
- **Micro spacing** (`8px, 12px`): Tight gaps within components, button icon spacing, inline text spacing
- **Small spacing** (`16px, 20px`): Padding inside cards, gaps between form fields, button groups
- **Medium spacing** (`24px, 28px, 32px`): Section padding, card separation, feature block gaps
- **Large spacing** (`36px, 40px, 48px`): Feature section padding, multi-column gaps
- **Extra-large spacing** (`64px, 80px`): Hero section padding, page-level section separation
### Grid & Container
- **Max Container Width:** `1200px`
- **Column Strategy:** Flexible 12-column grid for desktop; 2–3 columns for feature sections
- **Gutter:** `32px` between columns
- **Section Pattern:** Full-bleed background color with centered max-width content container; padding applied to container, not body
- **Padding (page sections):** `64px` vertical, `40px` horizontal on desktop
### Whitespace Philosophy
Whitespace is active and intentional. Generous margins between sections create visual rest and reduce cognitive load. Internal component spacing uses the 4px base scale to maintain alignment without feeling cramped. Multi-line content benefits from increased line height (1.4–1.6x) to support focus and prevent eye fatigue during reading. Never crowd interactive elements or instructional text—clarity and breathing room are prioritized.
### Border Radius Scale
- **Sharp corners:** `0px` (full-width backgrounds, structural containers)
- **Slight rounding:** `4px` (small interactive elements, input focus rings)
- **Standard rounding:** `6px` (small buttons, badges, subtle callouts)
- **Medium rounding:** `8px` (large buttons, standard cards, form inputs)
- **Large rounding:** `12px` (lesson containers, prominent cards, hero sections)
## 6. Depth & Elevation
| Level | Treatment | Use |
|-------|-----------|-----|
| 0 (Flat) | No shadow, `box-shadow: none` | Backgrounds, type-only areas, navigation |
| 1 (Subtle) | `rgba(40, 34, 24, 0.06) 0px 1px 3px 0px` | Standard cards, default containers, lifted text areas |
| 2 (Raised) | `rgba(40, 34, 24, 0.07) 0px 2px 8px 0px` | Hovered cards, modals, overlay containers, focused states |
| 3 (Floating) | `rgba(40, 34, 24, 0.1) 0px 4px 16px 0px` | Dropdowns, tooltips, popovers (inferred for advanced components) |
**Shadow Philosophy:** Shadows are warm-toned and restrained, using dark charcoal at low opacity to maintain the calming aesthetic. Elevation is subtle—just enough to suggest layering without creating visual drama. Shadows increase slightly on hover to provide tactile feedback. This approach keeps focus on content and interaction rather than graphical effects.
## 10. Agent Prompt Guide
### Quick Color Reference
- **Primary Text & Headings:** Dark Charcoal (`#2A2620`)
- **Primary CTA Buttons & Hover Backgrounds:** Warm Brown (`#665F51`)
- **Button Hover:** Darkened Warm Brown (`#3D3830`)
- **Primary Page Background:** Off-White (`#FCF9F6`)
- **Secondary Backgrounds & Light Cards:** Light Gray (`#F1EDEA`)
- **Secondary Text & Captions:** Muted Taupe (`#7B7771`)
- **Borders & Dividers:** Border Light (`#DCD9D7`) or Dust Tan (`#D9D1C0`)
- **Error/Warning Accent:** Dusty Red (`#7A3F3F`)
- **Success Accent:** Sage Green (`#3D5C3E`)
- **Overlay/Modal Background:** Pure White (`#FFFFFF`)
### Iteration Guide
1. **Use Newsreader serif exclusively** for all text. No sans-serif substitutions. Default fallback: `Georgia, serif`.
2. **Follow the typography hierarchy strictly:** H1 `72px 700 lh:79.2px`, body `16px–17.6px 400 lh:24px–29.92px`, buttons `14px–16px 600`, captions `12px 400`.
3. **Build all buttons with primary (`#665F51`), secondary (`#F1EDEA` + border), or ghost (transparent + border) variants.** Hover adds darker background or border; focus adds `0px 0px 0px 3px rgba(102, 95, 81, 0.1)` shadow.
4. **Apply padding and margins in `4px` multiples:** `8px, 12px, 16px, 20px, 24px, 28px, 32px, 36px, 40px, 48px, 64px, 80px`. Never use arbitrary spacing outside this scale.
5. **Cards and containers:** Use `#FFFFFF` or `#F1EDEA` background, `1px solid #DCD9D7` border, `8px` border-radius, and Level 1 shadow by default (`rgba(40, 34, 24, 0.06) 0px 1px 3px 0px`). Elevate to Level 2 on hover.
6. **All interactive elements must have minimum `44px` × `44px` touch targets** on mobile. Scale buttons and inputs up rather than down.
7. **Ensure contrast:** Text on light backgrounds uses `#2A2620` (21:1 ratio); secondary text uses `#7B7771` (8:1 ratio). Both meet WCAG AA.
8. **Responsive design is mandatory:** Implement the breakpoint table (mobile 320px, tablet 768px, desktop 1024px). Hero headings scale `32px → 56px → 72px`; feature grids go `1 → 2 → 3` columns.
9. **Reserve accent colors (sage, gold, red) for status states and subtle highlights only.** Do not use as primary UI colors.
10. **Maintain focus states on all interactive elements** with visible outlines or background highlights. Test keyboard navigation thoroughly.