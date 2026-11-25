---
title: Reminders and notifications
description: Ask Familiar to remind you or to do something on a schedule, and get notified on your devices.
---

## Ask for a reminder

Ask in plain words: "remind me to call Mum at 6", "every weekday at 8, give me the weather and my plans" or "check in on Friday about the boiler". Familiar saves each one as a schedule with a prompt for itself and a time. It can run once or repeat.

When a schedule is due, its prompt arrives in the room it was made in, like a message, and the Familiar replies to it. Reply to that message like any other, for example to snooze it. Times use the time zone of the computer Familiar runs on.

Ask Familiar to list or cancel schedules, or open **Schedules** in its settings to see what's coming, pause or cancel one. To change a schedule, Familiar cancels it and creates a new one.

A repeat runs at most once an hour, and Familiar keeps up to 50 schedules at a time.

## Notifications

Each scheduled reply is also sent as a notification to every device that has turned notifications on. Without notifications, schedules still run and their replies appear in the chat.

To turn them on, open **Settings › Notifications** on each device and choose **Enable**. Notifications need:

- an HTTPS address, such as the Tailscale address setup prints
- on iPhone and iPad, iOS 16.4 or later, with Familiar added to the home screen and opened from there

Turn them off again from the same place. Each device turns off only its own notifications.

If a device's push service stops answering for 30 seconds, Familiar gives up on that one notification. Other devices still get theirs.

## When the computer was asleep

If a schedule comes due while Familiar isn't running, it runs as soon as Familiar starts again. Its message notes that it arrived late.
