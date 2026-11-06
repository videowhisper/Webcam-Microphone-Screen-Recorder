# WordPress integration

VideoWhisper bundles this recorder in two WordPress plugins:

- [Video Posts Webcam Recorder](https://wordpress.org/plugins/video-posts-webcam-recorder/) adds recordings to WordPress post and video-sharing workflows.
- [Video Comments Webcam Recorder](https://wordpress.org/plugins/video-comments-webcam-recorder/) adds recordings to WordPress comments and comment forms.

Both plugins use the same browser recorder assets. Their recorder settings select the available capture types and their integration settings decide whether accepted media is saved to the WordPress Media Library. Video workflows can optionally pass accepted videos to compatible VideoWhisper video-sharing integrations; audio, photos, and screenshots remain Media Library items.

## Available capture types

When the bundled recorder is selected, plugin settings can expose these actions:

- Webcam video
- Microphone audio
- Screen capture, optionally with microphone audio
- Webcam photo
- Screenshot

The recorder asks for only the browser permissions required by the selected action. Browsers may not provide every input device or codec, so integrations should use the accepted result and its reported media information rather than assuming a fixed format.

## Add the recorder to a page

The recorder plugins provide their own shortcodes and controls. In a custom WordPress integration, use the plugin's documented recorder shortcode and pass the desired capture type or enabled types. Enable the direct-preview setting when the page should open the selected capture preview without the introductory screen.

Accepted results include the upload URL or WordPress attachment information and browser-reported media metadata. A custom integration can use that data to store an attachment reference, display the item, or redirect the user after a successful upload.

## Update the bundled recorder assets

From the exact source revision named in the plugin's `recorder/build-manifest.json`:

```bash
npm ci
npm run typecheck
npm run test
npm run build
```

Copy only `packages/recorder-vanilla/dist/videowhisper-recorder.browser.js` and `videowhisper-recorder.css` to the selected plugin's `recorder/` directory. Remove the JavaScript sourceMappingURL line and retain one final newline. Do not copy source maps, dependency directories, development servers or private app variants. Review and qualify each plugin independently before publishing it. The manifest records the exact source revision, build inputs and output checksums.

### Installed local app extension

The WordPress adapters own permissions, upload limits, media associations and accepted-result handling. Their versioned hook lets an installed extension supply its own local app, without adding private implementation or unlock flags to this Free source:

```php
add_filter('videowhisper_recorder_app_assets_v1', function ($assets, $context) {
    if (1 !== ($context['schema'] ?? null)
        || 'web-recorder' !== ($context['app'] ?? null)
        || 1 !== ($context['config_contract'] ?? null)
        || !in_array($context['plugin'] ?? '', array('video-posts-webcam-recorder', 'video-comments-webcam-recorder'), true)) {
        return $assets;
    }
    // Return verified local script_url, style_url and version for your installed app.
    // Keep the bundled assets when your local files are unavailable.
    return $assets;
}, 20, 2);
add_action('videowhisper_recorder_app_enqueued_v1', function ($assets, $context) {
    // Observe the final selected local assets. Never emit credentials or change permissions here.
}, 10, 2);
```

The adapters validate the returned URLs and fall back to their bundled app if the descriptor is invalid. An alternative app must honor supplied host limits, site permissions, upload authorization and result contracts. This hook does not grant uploads, publish content or install/activate an extension.

## Plugin testing checklist

1. Enable the capture types needed by the page or comment form.
2. Record, review, accept, and upload each enabled type.
3. Confirm the Media Library item and its media information when Media Library integration is enabled.
4. Confirm any configured video-sharing integration receives accepted video only.
5. Test the direct-preview option, any configured success redirect, and a browser that denies a requested device permission.
