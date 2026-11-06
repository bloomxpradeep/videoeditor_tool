# Reel Studio

Browser chat UI for directing Claude and the Premiere MCP. Each editor runs it on their own Mac, with their own
Premiere/After Effects and their own Claude account.

## Set up a new Mac

Needs macOS, [Homebrew](https://brew.sh), git, and Premiere Pro + After Effects from Creative Cloud.

```
git clone git@github.com:bloomxpradeep/videoeditor_tool.git     # or VS Code: Clone Repository
cd videoeditor_tool
bash scripts/setup-studio-mac.sh   # one time: Node, ffmpeg, whisper, Premiere MCP + panel, Studio build
npm run studio                     # starts Studio and opens http://localhost:8787
```

Setup runs with `bash` because a fresh Mac has no `npm` until setup installs Node. Run it inside the cloned
folder: `git clone` in Terminal puts it in the current folder (usually `~/videoeditor_tool`), VS Code puts it where
you picked. If you can't find it, type `cd ` in Terminal and drag the folder in from Finder.

If setup says Homebrew is required, install it with the command it prints, run the two "Next steps" lines
Homebrew shows at the end (on Apple Silicon: `echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile`
and `eval "$(/opt/homebrew/bin/brew shellenv)"`), then run setup again.

Then, in Studio, click **Sign in with Claude** at the bottom of the sidebar and sign in with your own Claude
account. Studio keeps that login for every job on this Mac. You don't need VS Code or a terminal Claude login.

Setup asks for the Magnific and ElevenLabs keys (Enter skips). To also install the house fonts, AE text styles
and editing memory, make a kit on the main Mac with `bash scripts/make-studio-kit.sh` and run
`bash scripts/setup-studio-mac.sh ~/Downloads/ReelStudioKit-<date>.zip`.

Once, by hand: in Premiere open **Window > Extensions > MCP Bridge (CEP)**; in After Effects turn on
**Settings > Scripting & Expressions > Allow Scripts to Write Files and Access Network**.

## Commands

```
npm run studio        # this Mac only: http://localhost:8787
npm run studio:dev    # hot-reload UI on :5173 for working on Studio itself
npm run studio:lan    # also open it to other Macs on the same network
```

## Use from another Mac on the same network

Nothing has to be installed on the other Mac; it only needs a browser. Claude, Premiere, After Effects, the API keys and fonts all stay on the studio Mac.

1. On the studio Mac, open Premiere and run `npm run studio:lan`. The first time, macOS asks whether `node` may accept incoming connections: click **Allow**.
2. The terminal prints the links to share (`http://<mac-name>.local:8787` and the IP form) and the passcode. The passcode is kept in `~/.studio_passcode`; edit that file and restart to change it, or set `STUDIO_PASSCODE`.
3. On the other Mac, open the link, enter the passcode, create a job, and drop the raw footage into the chat to upload it.
4. Finished videos play in the Output panel. **Download all** gets the exports and the Premiere project as one zip.

Notes:
- The studio Mac stays awake while `studio:lan` runs. Closing the terminal stops Studio for everyone.
- There is one Premiere, so run one job at a time.
- Browsers on the studio Mac itself never need the passcode.
- It only works inside the same network. To reach it from outside, put both Macs on Tailscale and use the studio Mac's Tailscale name.
