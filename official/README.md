# izumi's own plugins

Plugins izumi itself maintains. Each is listed like any other plugin: a listing in
`plugins/<id>/listing.json` pins a commit of this repository. Changes come by pull request (run
`node scripts/pin-main.mjs official/<name>` after editing a main file), and once a change is on
`main`, the hourly job checks and scans the plugin's folder at that commit before it moves the pin.

Jump to a moment was first published in the izumi app repository, under the GPL-3.0-or-later
licence, and keeps that licence here.
