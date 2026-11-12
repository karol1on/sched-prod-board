---
id: SCHED-4515
title: List holds still; "N new" bar brings new incidents in
status: ready
plan: R1 (changed), R2
---

Product's decision, 2026-11-12, after the step-1 recording (ack race at 00:11: pointer on INC-6786's Ack, INC-5956
landed, INC-9524 got the ack): "The list holds still while it is on screen; a "N new" bar brings new incidents in on
click. Ack stays on the row." — product

- New incidents no longer go into the list on refresh. They wait; a bar (`data-testid="new-bar"`) above the list
  says how many. Its space is reserved, so showing it moves nothing.
- A click on the bar puts the waiting incidents at the top, newest first, without moving or re-creating the rows
  already shown.
- Ack stays on each row (`data-testid="ack"`), new rows included.

Acceptance: with the board open and incidents landing, the top row does not change and no row moves; the bar shows
the count; a click on it puts the new ones on top; an Ack clicked by position while an incident lands acks the
row under the pointer.
