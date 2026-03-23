//! Theme presets (Gruvbox-inspired dark / light).

use ratatui::style::{Color, Modifier, Style};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemePreset {
    Dark,
    Light,
    /// Colorful accents (btop-inspired).
    BtopRainbow,
    /// Follow system — default to dark for now.
    Auto,
}

impl ThemePreset {
    pub fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "light" => ThemePreset::Light,
            "btop-rainbow" | "btop_rainbow" | "rainbow" => ThemePreset::BtopRainbow,
            "auto" => ThemePreset::Auto,
            _ => ThemePreset::Dark,
        }
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)] // palette reserved for charts / alerts / help styling
pub struct Theme {
    pub bg: Color,
    pub fg: Color,
    pub muted: Color,
    pub accent: Color,
    pub good: Color,
    pub warn: Color,
    pub bad: Color,
    pub border: Color,
    pub title: Style,
    pub help_key: Style,
}

impl Theme {
    pub fn from_preset(p: ThemePreset) -> Self {
        match p {
            ThemePreset::Auto | ThemePreset::Dark => Self {
                bg: Color::Rgb(40, 40, 40),
                fg: Color::Rgb(235, 219, 178),
                muted: Color::Rgb(146, 131, 116),
                accent: Color::Rgb(131, 165, 152),
                good: Color::Rgb(184, 187, 38),
                warn: Color::Rgb(250, 189, 47),
                bad: Color::Rgb(251, 73, 52),
                border: Color::Rgb(80, 73, 69),
                title: Style::default()
                    .fg(Color::Rgb(251, 241, 199))
                    .add_modifier(Modifier::BOLD),
                help_key: Style::default()
                    .fg(Color::Rgb(214, 93, 14))
                    .add_modifier(Modifier::BOLD),
            },
            ThemePreset::BtopRainbow => Self {
                bg: Color::Rgb(26, 27, 38),
                fg: Color::Rgb(220, 220, 230),
                muted: Color::Rgb(147, 153, 178),
                accent: Color::Rgb(137, 180, 250),
                good: Color::Rgb(166, 227, 161),
                warn: Color::Rgb(249, 226, 175),
                bad: Color::Rgb(243, 139, 168),
                border: Color::Rgb(88, 91, 112),
                title: Style::default()
                    .fg(Color::Rgb(203, 166, 247))
                    .add_modifier(Modifier::BOLD),
                help_key: Style::default()
                    .fg(Color::Rgb(250, 179, 135))
                    .add_modifier(Modifier::BOLD),
            },
            ThemePreset::Light => Self {
                bg: Color::Rgb(251, 241, 199),
                fg: Color::Rgb(60, 56, 54),
                muted: Color::Rgb(102, 92, 84),
                accent: Color::Rgb(69, 133, 136),
                good: Color::Rgb(121, 116, 14),
                warn: Color::Rgb(181, 118, 20),
                bad: Color::Rgb(204, 36, 29),
                border: Color::Rgb(189, 174, 147),
                title: Style::default()
                    .fg(Color::Rgb(40, 40, 40))
                    .add_modifier(Modifier::BOLD),
                help_key: Style::default()
                    .fg(Color::Rgb(175, 58, 3))
                    .add_modifier(Modifier::BOLD),
            },
        }
    }
}
