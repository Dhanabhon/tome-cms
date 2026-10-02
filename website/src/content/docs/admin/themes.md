---
title: Themes
description: Choose how your public site looks, adjust what its theme offers, and decide whether readers see it light or dark.
sidebar:
  order: 8
---

"Themes", under "Appearance" in "Configuration", chooses which theme your public site uses, and whether readers see it light or dark. Three themes come with TomeCMS: Paper, which a new site starts with, Plain, a sparer one, and Almanac, a warmer one with serif headings. Every control on this screen applies the moment you use it, so there is no save bar at the bottom. Only the "Customize" drawer has a "Save" of its own.

![The Themes screen, with a count of 2. The Paper card shows a small preview of the site's home page with the headline "Ideas, carefully published.", the description "Paper surfaces and hairline rules: the look TomeCMS ships with.", and "In use", "Customize" and "View site" under it. The Plain card shows a one-column preview and a "Use this theme" button. Below are the card "Where themes come from" and the "Appearance" card, where "Site appearance" is "System" and "Let visitors choose light or dark" is ticked.](../../../assets/screenshots/en/themes.png)

## Choosing a theme

Each theme has a card, and the top of the card is a preview: the theme drawing your own home page, in the site's default language, with your three newest posts and the theme's saved settings. The preview is only an image, so clicking it does nothing. Under the preview are the theme's name and one line about it. That line is written in English on both languages' screens.

The card of the theme in use says "In use". "View site" opens the public site in a new tab. On any other card, "Use this theme" switches the site to it straight away, and the screen names the theme now in use, as in "Your site now uses Plain."

Paper shows a band at the top of the home page, a grid of cards for the posts, and an author block at the end of each post. Plain shows the tagline, the categories and a single column of titles with their dates and excerpts, in the reader's system font. It has no hero, so "Home slides" do not show with it, and it has nothing to customize.

Almanac is described under [Customizing Almanac](#customizing-almanac) below.

Themes come with TomeCMS, as the card "Where themes come from" says. Nothing on this screen installs one.

## Customizing Paper

"Customize" is on the card of the theme in use, when that theme has settings. For Paper it opens "Customize Paper" at the side of the screen. Change what you want and press "Save". The drawer closes and the screen says "Saved."

Settings are kept for each theme separately. Paper's stay as you left them while Plain is in use, and come back when you switch to Paper again.

| Setting | Choices | What it does |
| --- | --- | --- |
| "Hero" | "Text" (to begin with), "Moving text", "Covers of the newest posts", "Your slides", "Hidden" | The band above the grid. "Text" shows the headline. "Moving text" reveals it once, when the reader arrives. "Covers of the newest posts" turns through up to five of the newest posts that have a cover, and needs at least two. "Your slides" shows what you keep under [Home slides](/tome-cms/admin/home-slides/). "Hidden" leaves the band out. When covers or slides have nothing to show, the band shows the headline instead. A reader who asked their device for less motion sees no movement. |
| "Headline" | Up to 60 characters | The words in a text hero. Left empty, the theme writes its own in the language the page is read in: "Ideas, carefully published." in English. Not shown with covers or your slides. |
| "Slides turn by themselves" | On (to begin with) or off | For your slides only. A reader can always stop them, and a reader who asked for less motion never sees them turn. |
| "Seconds per slide" | "4", "6" (to begin with), "8" | How long each of your slides stays before the next. |
| "Slides change by" | "Sliding" (to begin with), "Fading" | Fading needs a browser that can animate as the page scrolls. Other browsers slide. |
| "Posts per load" | "6" (to begin with), "12", "18" | How many posts the home page shows at a time. Multiples of six fill the last row at one, two or three cards across. |
| "Cards across" | "2", "3" (to begin with), "4" | The most cards in a row, on the widest screen. A narrower screen holds fewer, and a phone shows one. |
| "Keep the header in view" | On or off (to begin with) | The header stays at the top of the window while the reader goes down the page. |
| "Reading position" | "Off" (to begin with), "Bar at the top", "Rail at the side" | Where a reader is in a post. The bar is a thin line across the top that fills as they go down it. The rail is a column of ticks beside the text, one for each heading, with the one being read longer and in the accent colour, the headings already read darker, and each tick is a link to its heading; hovering or focusing one shows the heading's words. It needs a post with at least two headings and a window at least 64rem wide, and a narrower one, or a post with fewer headings, shows the bar instead. |
| "Author links" | "Words" (to begin with), "Icons", "Icons and words" | How the links from your [profile](/tome-cms/admin/settings/) appear under the author at the end of a post. A link to GitHub, X, LinkedIn, Facebook, Instagram or YouTube gets that site's mark, and any other link a plain link icon. |
| "Load more as the reader scrolls" | On (to begin with) or off | New rows appear as the reader nears the end of the grid. Off leaves the "Older posts" link, which a reader without JavaScript follows anyway. |

## Customizing Almanac

Almanac is a warm theme: the page is warm paper, headings are in a serif face (Trirong, with Thai letters), the accent is a deep moss green, and posts without a cover get a soft tinted panel. Its header holds the site's name with the header menu right after it, and the search box at the right end; on a phone the search is a button that opens the box. The language switch and the light/dark control are in the footer, at the right, after the footer menu. Its home page is a hero band, a row of category pills, and a grid of cards, three across on a wide screen, two on a tablet and one on a phone. A card is one link to its post. A post with a cover shows it, and one without shows the first letter of its category on a panel whose tone belongs to that category, so a category always has the same tone. There are six tones, so two categories can share one. A post is a single reading column about 68 characters wide, with its category as a pill above the title and a "More in" link to that category at the end. A page is the same column with only a title. Light and dark are both designed, and a reader who asked their device for less motion sees nothing lift, fade or fill.

Almanac has no "Home slides" and no choice about how many posts load at a time: the list holds six and ends with a "More posts" link. "Customize" opens "Customize Almanac". Settings are kept for each theme separately, as they are for Paper.

| Setting | Choices | What it does |
| --- | --- | --- |
| "Hero" | On (to begin with) or off | The band above the posts: a headline, a line under it and two buttons. It shows on the first page only, and not while a reader is searching. Off leaves the band out, and the page still has its heading for readers who use a screen reader. |
| "Headline" | Up to 120 characters | The big words in the hero. Left empty, the site's name. |
| "Lead" | Up to 240 characters | The line under the headline. Left empty, the tagline from [General settings](/tome-cms/admin/settings/). |
| "First button" | Up to 40 characters | The label of the filled button. Left empty, "Start reading" in English and "เริ่มอ่าน" in Thai. |
| "First button's link" | Up to 2048 characters | Where it goes: a path on this site starting with `/`, or an address starting with `https://`. Left empty, the newest post. |
| "Second button" | Up to 40 characters | The label of the outlined button. Left empty, "All posts" in English and "บทความทั้งหมด" in Thai. |
| "Second button's link" | Up to 2048 characters | Left empty, the list of posts further down the home page. |
| "Reading progress" | On (to begin with) or off | A thin bar across the top of a post that fills as the reader goes down it. The browser draws it from the scroll position, so the page carries no script for it. A browser that cannot do that shows no bar, and neither does a reader who asked for less motion. |

A button with no words, or whose link is not allowed, is left out rather than drawn broken. A link is allowed when it is a path on this site that starts with a single `/`, or an address that starts with `https://`, and has no spaces in it. Anything else, such as `http://`, `mailto:`, `javascript:` or `//`, leaves the button out. The setting is kept as typed, so the button comes back once you correct the link. Left empty, a label or a link uses the theme's own words in the language the page is read in, so a Thai reader meets "เริ่มอ่าน" without you writing it.

## Searching the posts

All three bundled themes have a search box. Paper and Plain put it above the posts on the home page, and Almanac puts it in the header of every page. It finds the published posts, in the language of the page, that contain every word typed, whether the word is in the title, the excerpt or the text. It matches inside words and ignores case, which is what lets it work in Thai. The box is an ordinary form, so it works without JavaScript, and a page of results is kept out of search engines. Paper and Almanac hide their hero while results are on screen, and choosing a category leaves the search. A reader who searches more than 60 times in a minute is asked to wait, so a script cannot keep the database busy. There is nothing to switch on. A [headless site](/tome-cms/api/overview/) asks for the same thing with `q`.

## Light and dark for readers

The "Appearance" card at the bottom of the screen decides how the public site looks to readers.

"Site appearance" is "System", "Light" or "Dark", for every reader. "System" lets each reader's device choose.

"Let visitors choose light or dark" is ticked to begin with. It puts a "Theme" control in the site's header (in Almanac, in the footer), where a reader picks "Light", "Dark" or "System" for themselves. Their choice is kept in their own browser, as [What a reader's browser keeps](/tome-cms/running/privacy/) describes. Untick it and the site setting is the only one: a choice a reader made before is ignored, and the public pages carry no script for the control.

The admin has its own light and dark, "Admin appearance" at the bottom of the sidebar. It applies to the admin on the device you set it on, and readers never see it.

This screen and "General" under "Settings" save to the same record. If "Settings" was saved in another tab after this screen opened, the change here is refused, so it cannot undo that save. Reload the screen and make the change again.
