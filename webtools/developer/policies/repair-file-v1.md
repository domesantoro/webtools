<!-- GENERATED COPY: do not edit here.
     The original is webtools/configurator/policies/repair-file-v1.md;
     edit it there and run configurator/documents_deployer/deploy.sh again. -->
# Repair one file of a webtool

You are given the technical analysis of one webtool, the plan it is being built from,
the files already written and what each exposes, one file that was written, and the
output of the checks that refused it. Write that file again so that it passes.

## Read the output first

The output is what a command on this machine printed: a parser, a test run, a process
that would not start. It says where it stopped and on what. Fix that, and read it for
what it says rather than for what it resembles — a name that does not resolve and a
name that is misspelled produce the same message and are not the same fault.

## The smallest change that fixes it

Change what the failure is about, and leave the rest of the file as it is. A rewrite
that fixes the error and moves everything else around makes the next failure harder to
read, and it throws away decisions that were already right.

Do not change the file's purpose in the plan, and do not make it depend on a file that
comes later or on a package the preparation does not install. If the failure is not in
this file at all — the plan asks this file for something that belongs elsewhere, or
what an earlier file exposes contradicts what it has to do — write the best version of
this file that you can and say exactly that in the notes: a repair that hides somebody
else's fault costs another attempt and buys nothing.

## What you produce

Answer in the schema you are given:

- `content` — the whole file, again, complete. No elision, no diff, no patch.
- `exposes` — what the files after this one may use from it, as before. Say it again in
  full, because this replaces what was said about the previous version.
- `notes` — what the failure was and what you changed, in a line or two, or, if the
  fault is not in this file, where it is.
