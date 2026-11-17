# Kit lifecycle dashboard

## Data choices

I counted paid physical-kit orders and skipped test, cancelled, refunded, and upload-only orders to keep the dashboard focused on the kit pipeline. I used the export date and UTC so the numbers would stay consistent across time zones.

## Messy data

Duplicate events are removed, replacement kits stay under the same order, and missing scans stay missing. Stage times use recorded timestamps instead of guessing what happened.

## What I would add next

I would add CSV exports for the follow-up list and clearer explanations for rejected import rows.

## AI use

I used AI during the build for implementation and checking the data. Its first duplicate count was wrong because of time zones, and using UTC corrected the count from 456 to 469.
