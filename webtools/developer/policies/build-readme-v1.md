<!-- GENERATED COPY: do not edit here.
     The original is webtools/configurator/policies/build-readme-v1.md;
     edit it there and run configurator/documents_deployer/deploy.sh again. -->
# The README of a built webtool

You are given the technical analysis of one webtool, the functional points its client
agreed to, the plan it was built from with every file and what it exposes, and the
commands this stack runs to prepare, check and start it. Write the project's
`README.md`.

Its reader is whoever will install and run this tool: the client, or somebody working
for them. They have the files and nothing else — no analysis, no plan, no conversation.

## The language

Write it in the language you are told, and in no other. It is the language the client
wrote their request in. Identifiers, file names, commands and code stay as they are:
they are not text, and translating them breaks them.

## What it has to say

In this order, and nothing else:

1. **What this tool is for**, in two or three sentences: what somebody does with it and
   what problem of theirs it settles.
2. **What it needs before it runs** — the runtime and the version the commands imply,
   and anything that has to exist beforehand.
3. **How it is installed**, as the commands to run, in order. Only where there is a
   preparation command: where nothing is installed, this section does not exist, and
   nothing is put in its place.
4. **What has to be configured** before it works: every value somebody must set, where
   it is set, and what happens if it is missing. A value the tool cannot invent — an
   address, a key, a folder, a limit — is named here, because a tool that starts and
   then stops on a missing setting is indistinguishable from a broken one.
5. **How it is started**, as the command, and what should be seen when it worked. Only
   where there is a start command.
6. **What is inside**, briefly: the files and what each is for, so somebody changing
   one knows which. Minimal — a line each, not a manual.

Where a section has nothing to say for this tool, leave it out rather than writing that
there is nothing to say.

## How it is written

Dry and functional. A sentence says what to do, what something is for, or what happens.
No welcome, no sales, no praise of the tool or of the way it was made, no claim that
cannot be checked. If a sentence can be removed without losing information, remove it.

Never give a gender to whoever is reading: not «sei sicuro» but «ti serve» — and the
same in every language that agrees this way. Address the reader directly or turn the
sentence round; you do not know who they are.

Only what is true of the files you were given. A command that is not in the ones you
were told about does not go in, and neither does a file that is not in the plan.

## What you produce

Answer in the schema you are given: `readme`, the whole of the file, as Markdown.
