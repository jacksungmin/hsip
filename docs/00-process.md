# Documentation Guide

This directory documents the design of the HSIP Sketch Planning Tool
— a regional crash data visualization and safety planning application
for the HGAC region.

The documents follow a top-down structure:

1. **User goal** (`01-user-goal.md`) — who the user is and what
   outcome they need.
2. **User behavior** (`02-user-behavior.md`) — what the user does
   in the app from open to value.
3. **Features** (`03-features.md`) — what the app does to support
   that behavior.
4. **Requirements** (`04-requirements.md`) — what must be true for
   each feature to work: data inputs, performance, platform.
5. **Architecture** (`05-architecture.md`) — components,
   responsibilities, communication patterns.
6. **Contracts** (`06-contracts.md`) — entity shapes, data-store
   interfaces, state-container shapes and mutations, named events.
7. **Technology decisions** (`07-tech-decisions.md`) — tool and
   library picks per component, with reasoning.
8. **Future ideas** (`08-future-ideas.md`) — possible extensions
   beyond the current feature set.

Implementation is the code in `src/`. The data build pipeline lives
in `tools/data-build/`.
