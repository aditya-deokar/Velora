---
name: velora-ewmotion
description: Explicit deferral notice for Ewmotion workflows. Use when asked about Ewmotion to get the honest status and the supported alternative path.
license: MIT
version: 0.1.2
when-to-use: Any request naming Ewmotion, or triaging whether an Ewmotion adapter exists for this CLI version.
prerequisites:
- velora loaded for routing
commands:
- validate
- guide
related-skills:
- velora
- velora-scenes
- velora-debug
not-for: Claiming an Ewmotion adapter, importer, or runtime that this CLI does not ship; this skill never stubs unbuilt behavior.
---

# Velora Ewmotion — Deferred With Reason

This skill is an explicit deferral notice, not a stub claiming unbuilt behavior. No Ewmotion source, package, or adapter ships with this CLI version.

## When to Use This Skill

Load this skill when the request mentions Ewmotion workflows, migration from Ewmotion, or an Ewmotion bridge. It tells you what does not exist and which supported path to use instead.

## Commands

- `velora guide --json`: canonical motion and scene contracts to use instead of an Ewmotion importer.
- `velora validate --json`: gates the supported alternative before rendering.

There is no Ewmotion subcommand. Do not document one; the top-level help does not list it and this skill must not invent it.

## Prerequisites

- Acceptance that Ewmotion integration is deferred pending a real source to integrate.
- A Velora-native plan using recipes, motion tracks, and composition files.

## Workflow

1. State the deferral to the requester with the reason below.
2. Reframe the request as a Velora scene: identify the live component, shot family, and timeline.
3. Follow `velora-scenes` and `velora-composition` with real commands.
4. Run `velora validate --json` and prove with `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`.

Reason: zero hits for Ewmotion in source, tests, scripts, skills, and dependencies for this version. Per the no-mock rule, no adapter, importer, or bridge is claimed until a source surfaces. Reopen only when a package or spec exists to integrate and test.

## Worked Example

Request: "import my Ewmotion project."

Response path:

```bash
velora guide --json
velora inspect --json
velora validate --json
```

Rebuild the timeline as Velora recipes plus motion tracks using `velora-scenes`; do not promise byte-identical Ewmotion import.

## Anti-Patterns

- Inventing an Ewmotion import command or similar commands.
- Claiming silent Ewmotion compatibility in compositions or validators.
- Copying Ewmotion concepts as if they were Velora contracts.
- Leaving the requester without a supported alternative path.

## Troubleshooting

- Requester insists on Ewmotion: restate the deferral, cite this skill version, and offer the Velora-native rebuild.
- `ERR_UNKNOWN_COMMAND` for any Ewmotion spelling: expected; run the top-level help to list real commands.
- Future source surfaces: file a follow-up to design the adapter with tests; do not stub it here.

## Validation

- This skill documents zero Ewmotion commands or flags.
- `velora validate --json` passes for the Velora-native alternative.
- `velora skills check --json` passes; this file meets the content contract without claiming unbuilt behavior.

## Related Skills

- `velora`: root routing.
- `velora-scenes`: supported scene authoring path.
- `velora-debug`: `velora validate --json` diagnostics.

## When NOT to Use This Skill

- Do not use this skill for GSAP, Three.js, or DOM motion; load `velora-gsap`, `velora-threejs`, or `velora-scenes`.
- Do not use this skill to unblock a render; it owns no render path.
- Do not cite this skill as proof of Ewmotion support; it proves deferral.
