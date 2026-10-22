# Prompt Upgrade

A Claude Code mod that turns a rough prompt into a great one before it is sent. It opens a pane, asks up to three quick multiple-choice questions, rewrites the prompt, and shows your original and the upgrade side by side. Nothing runs until you press **Run it**.

## Commands

- `/better <prompt>` upgrades that prompt.
- `/better` opens a box in the pane to type one.
- `/better on` / `/better off` turn automatic mode on or off. With it on, a prompt you type opens in the pane first.
- `/better history` shows your last 20 upgrades; pick one to reopen its review.

## What goes straight through in automatic mode

Slash commands, prompts with files or images attached, messages sent while Claude is working, short replies such as "yes" or "keep going", and anything starting with `>` (the `>` is removed before sending).

## The steps

1. **Your prompt**: shown in a card while the mod reads it.
2. **Questions**: up to three, each with two to four options, plus "Other (type it)" and "Skip".
3. **Rewrite**: the model writes the upgrade and lists what it added. Unknowns are left as `[placeholders]`; it never invents facts.
4. **Review**: word counts, then Run it, Edit, Copy and Cancel, what was added, and the two prompts side by side.

Cancel, or closing the pane, puts your original prompt back in the prompt box. If a model call fails you get Try again, Send my original, or Cancel.

## Cost

Each upgrade makes two model calls on your own Claude account: a fast model (Haiku) for the questions and Sonnet for the rewrite.

## Install

This repository is private: you need read access to it on GitHub, and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

At the prompt of a Claude Code terminal session:

```
/plugin install prompt-upgrade --marketplace alfath80-ai/better-prompt
```

Answer `y` to add the marketplace, then pick a scope (user is first).

From a shell:

```
claude plugin install prompt-upgrade --marketplace alfath80-ai/better-prompt
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `alfath80-ai/better-prompt`, then Add plugin.
