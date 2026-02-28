# Wallpaper Shuffler

A sleek, Electron-based desktop wallpaper control center designed specifically for KDE Plasma environments with dual-monitor setups. Build your wallpaper rotation, set cadence rules, and apply dual-screen wallpapers seamlessly without relying on external system timers.

## Features

- **Dual-Monitor Splitting:** Automatically slices wide wallpapers down the middle for perfect dual-screen framing using ImageMagick.
- **KDE Plasma Native:** Applies images directly to your active KDE Plasma desktop via `qdbus` background scripting.
- **Smart Rotation:** Intelligent shuffle mode with immediate repeat avoidance, or strictly sequential A-to-Z sorting.
- **Modern UI:** Built with Vite and Electron, featuring a premium dark indigo interface with soft glowing neon highlights.
- **Background Timers:** Calculates live rotation countdowns via internal IPC messaging.

## Prerequisites & Dependencies

Because this app manipulates the active X11/Wayland desktop environment and slices high-resolution images, it requires a few system-level dependencies:

### 1. Node.js & npm
Required for the Electron environment and the Vite build system.

### 2. ImageMagick (`magick`)
Used internally in the background to cleanly slice wide wallpapers into distinct left/right images for each display.
```bash
# Fedora / Bazzite
sudo dnf install ImageMagick

# Ubuntu / Debian
sudo apt-get install imagemagick

# Arch Linux
sudo pacman -S imagemagick
```

### 3. qdbus
Used to communicate directly with the KDE Plasma shell to inject the new wallpaper configurations. This is usually pre-installed on most modern KDE distributions.
```bash
# Fedora / Bazzite (typically included)
sudo dnf install qt5-qttools

# Ubuntu / Debian
sudo apt-get install qdbus-qt5
```

## Setup & Installation

Navigate to the project directory and install the required npm dependencies:
```bash
npm install
```

## Commands

### Development Mode
During UI development or debugging, boot the app with the Vite Hot Module Replacement (HMR) server so CSS and React changes refresh the window instantly:
```bash
npm run dev
```

### Production Build
To bundle the frontend application assets and run the standalone Electron build:
```bash
npm run build
npm start
```
