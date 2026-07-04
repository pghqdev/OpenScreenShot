# Privacy Policy for OpenScreenShot

**Last updated:** July 2026

## Data collection

OpenScreenShot does **not** collect, store, transmit, or share any personal data, usage data, or any other information from its users.

## How it works

All processing — including page capture, image compositing, annotation editing, and export — happens **entirely locally** in your browser. No data ever leaves your device.

The extension requires the following permissions, each with a narrow purpose:

| Permission                       | Why it's needed                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                      | Capture a screenshot of the current page when you click the extension or use a keyboard shortcut.                                                  |
| `scripting`                      | Inject small page-context functions to measure scroll height and scroll the page during a full-page capture.                                       |
| `storage` (+ `unlimitedStorage`) | Remember your settings (theme, export format, filename template, etc.) and temporarily hold a large captured image so the editor page can load it. |
| `downloads`                      | Save the exported PNG, JPEG, WebP, or PDF to your computer's downloads folder.                                                                     |
| `options_ui`                     | The editor is registered as the extension's options page so it can be opened in a tab after a capture.                                             |

## Third-party services

OpenScreenShot does not use any third-party analytics, advertising, or data-processing services. The generated PDFs are created by [jsPDF](https://github.com/parallax/jsPDF), an open-source library that runs entirely in your browser — no network requests.

## Changes to this policy

If this policy ever changes, the updated version will be published here with a new "Last updated" date.

## Contact

For questions about this privacy policy, open an issue on the [GitHub repository](https://github.com/openscreenshot/openscreenshot).
