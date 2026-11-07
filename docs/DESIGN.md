# Thought to Reality — Design System v1

**Direction: "a calm instrument."** Linear's 2026 refresh (quiet chrome, hierarchy by brightness), Teenage Engineering and Nothing (one signal colour, mono hardware labels), visionOS (sparing soft depth). 2026 trend consensus: calm over spectacle, motion that explains, AI as copilot with a clear "about to do this" moment.

## Palette (dark-first)
| Token | Hex | Use |
|---|---|---|
| bg | `#0B0B0C` | canvas |
| surface | `#141416` | panels |
| raised | `#1C1C1F` | popovers, hover |
| line | `#26262A` | 1px hairlines only |
| text | `#EDEDEF` | primary |
| text-2 | `#9A9AA1` | secondary |
| text-3 | `#5E5E66` | hints, units |
| signal | `#FF5A1F` | the single accent: primary action, live state |
| ok | `#3DD68C` | fit pass / converged |
| warn | `#F5B544` | tight tolerance |
| err | `#F2555A` | collision / fail |
| model | `#D9D6CF` | default material on the 3D mesh (warm clay) |

Light mode: bg `#F6F5F2`, surface `#FFFFFF`, text `#111113`, same signal.

## Typography
- **Inter Tight** (variable) for UI. Sizes 13/15/20/32, weights 450/550.
- **Geist Mono** for numbers, dimensions, and training metrics, with `tabular-nums` on.
- **Instrument Serif** italic 40px: empty-state headline only.
- −0.01em tracking at 20px+. Labels: uppercase mono 11px, +0.06em.

## Spacing, radius, elevation
- 4px base. Steps: 4, 8, 12, 16, 24, 32, 48, 64. Panel padding 16. Canvas gutters 24.
- Radius: 6 for chips and inputs, 10 for buttons, 14 for panels, 22 for the prompt box, full for pills.
- No chrome shadows. Floating panels over canvas: `0 8px 32px rgb(0 0 0/.4)` + `backdrop-blur(20px)`.

## Motion
- Durations: micro 120ms, UI 200ms, panel 320ms, camera 600ms.
- Easing: out `cubic-bezier(.22,1,.36,1)`, in-out `cubic-bezier(.65,0,.35,1)`. Springs for 3D: stiffness 170, damping 26.
- 30ms list stagger; `prefers-reduced-motion` → crossfades. Every motion answers "what changed?"; only live training loops.

## Screens and states
1. **Prompt (empty).** 640px prompt box, serif line *What should exist?* Three ghost example chips fade in after 800ms idle. ⏎ to go.
2. **Understanding.** Prompt docks to a top pill. A plan strip streams in (Diagnose → Design → Verify), editable before anything runs.
3. **Model.** Full-bleed three.js. Left part rail (48px collapsed); right inspector with 3–5 parametric sliders. Dimensions appear on hover.
4. **Fit test.** Part plus a ghost of its context, clearance heatmap (ok→warn→err), one verdict chip ("Fits · 0.4 mm"), scrubbable timeline.
5. **Train (moving parts).** The robot moves in the canvas; a bottom sheet holds reward sparkline, episode count and a "good enough" marker. Pause always visible.
6. **Make.** Summary card (material, print time, cost, STL/STEP). Primary "Order print", secondary "Print myself". Confirm before any spend.

## Components
PromptBox · PlanStrip · StepPill · Canvas3D (OrbitControls, grid floor at 6% opacity) · PartRail · Inspector · ParamSlider (drag the value, ⇧ for fine steps) · VerdictChip · Heatmap legend · Sparkline · Timeline scrubber · BottomSheet · Toast (undo, 5s) · HintTip · KbdKey · ConfirmSheet · ⌘K palette.

## Microinteractions
- Slider drag updates the mesh live; 120ms settle pulse on release.
- Part hover: signal outline at 60%, others dim to 40%.
- Step pill: thin progress ring, morphs to ✓ in 200ms.
- Every AI change toasts with Undo; version dots in the timeline.
- Camera auto-frames each step; any user orbit overrides it (lock icon).

## Hover hint pattern
Icons stay unlabeled; after a 400ms hover a **HintTip** shows one line (≤6 words) + KbdKey on raised colour, 6px radius, 8px offset, 120ms fade-and-rise 4px. First run: one pulse dot on the next likely control, never a tour.

## Empty, loading and error states
- **Empty:** prompt + chips only.
- **Loading:** wireframe sketch of the mesh draws in; no spinners.
- **Error:** inline with a fix ("Too thin to print. Thicken to 2 mm?" [Apply]).
- **Nothing to train:** "Static part. Nothing to train." in text-3.

## References
1. Linear, "A calmer interface for a product in motion": https://linear.app/now/behind-the-latest-design-refresh
2. Figma Config 2026 recap: https://www.figma.com/blog/config-2026-recap
3. Adam CADAM (prompt + sliders): https://adam.new/cadam (source https://github.com/Adam-CAD/CADAM)
4. Zoo Design Studio / Zookeeper: https://zoo.dev/zookeeper
5. Teenage Engineering (labels, one accent): https://teenage.engineering
