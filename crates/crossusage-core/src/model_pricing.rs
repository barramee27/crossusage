//! Bundled model pricing (supplement + LiteLLM compact snapshot).
//! Ports upstream OpenUsage v0.7.3+ aliases; v0.7.4 #909 refreshes price lists hourly
//! upstream via gh-pages. This fork ships the bundled supplement (`updated_at` in JSON)
//! and does not fetch over the network — optional follow-up if live refresh is needed.

use crate::log_usage_types::TokenBreakdown;
use regex_lite::Regex;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

const SUPPLEMENT_JSON: &str = include_str!("../data/pricing_supplement.json");
const LITELLM_JSON: &str = include_str!("../data/pricing_litellm_snapshot.json");

#[derive(Debug, Clone)]
pub struct ModelRates {
    pub input_per_million: f64,
    pub output_per_million: f64,
    pub cache_write_per_million: f64,
    pub cache_read_per_million: f64,
    pub input_above_200k: Option<f64>,
    pub output_above_200k: Option<f64>,
    pub cache_write_above_200k: Option<f64>,
    pub cache_read_above_200k: Option<f64>,
    pub fast_multiplier: f64,
}

impl ModelRates {
    pub fn scaled(&self, factor: f64) -> Self {
        Self {
            input_per_million: self.input_per_million * factor,
            output_per_million: self.output_per_million * factor,
            cache_write_per_million: self.cache_write_per_million * factor,
            cache_read_per_million: self.cache_read_per_million * factor,
            input_above_200k: self.input_above_200k.map(|v| v * factor),
            output_above_200k: self.output_above_200k.map(|v| v * factor),
            cache_write_above_200k: self.cache_write_above_200k.map(|v| v * factor),
            cache_read_above_200k: self.cache_read_above_200k.map(|v| v * factor),
            fast_multiplier: 1.0,
        }
    }

    /// Dollar cost of one request. When `apply_long_context_rates` and prompt tokens
    /// (input + cache writes + cache reads) exceed 200k, the whole request uses the
    /// long-context tier rates (upstream OpenUsage 0.7.4 #885).
    pub fn cost_dollars(&self, tokens: &TokenBreakdown) -> f64 {
        self.cost_dollars_with_options(tokens, true)
    }

    pub fn cost_dollars_with_options(
        &self,
        tokens: &TokenBreakdown,
        apply_long_context_rates: bool,
    ) -> f64 {
        const CACHE_WRITE_1H_MULT: f64 = 2.0;
        let mult = if tokens.is_fast { self.fast_multiplier } else { 1.0 };
        let prompt_tokens =
            tokens.input + tokens.cache_write5m + tokens.cache_write1h + tokens.cache_read;
        let use_long = apply_long_context_rates && prompt_tokens > 200_000;
        let input_rate = selected_rate(self.input_per_million, self.input_above_200k, use_long);
        let output_rate = selected_rate(self.output_per_million, self.output_above_200k, use_long);
        let cache_write_rate =
            selected_rate(self.cache_write_per_million, self.cache_write_above_200k, use_long);
        let cache_read_rate =
            selected_rate(self.cache_read_per_million, self.cache_read_above_200k, use_long);
        let cache_write_1h_rate =
            selected_rate(self.input_per_million, self.input_above_200k, use_long)
                * CACHE_WRITE_1H_MULT;

        let cost = flat_cost(tokens.input, input_rate)
            + flat_cost(tokens.output, output_rate)
            + flat_cost(tokens.cache_write5m, cache_write_rate)
            + flat_cost(tokens.cache_write1h, cache_write_1h_rate)
            + flat_cost(tokens.cache_read, cache_read_rate);
        cost * mult
    }
}

fn selected_rate(base: f64, long_context: Option<f64>, use_long: bool) -> f64 {
    if use_long {
        long_context.unwrap_or(base)
    } else {
        base
    }
}

fn flat_cost(tokens: i32, rate_per_million: f64) -> f64 {
    if tokens <= 0 {
        return 0.0;
    }
    f64::from(tokens) * rate_per_million / 1_000_000.0
}

struct AliasRule {
    pattern: Regex,
    canonical: String,
}

struct PricingSupplement {
    pricing: HashMap<String, ModelRates>,
    fast_multipliers: HashMap<String, f64>,
    alias_rules: Vec<AliasRule>,
}

#[derive(Deserialize)]
struct SupplementFile {
    pricing: HashMap<String, SupplementRates>,
    fast_multipliers: HashMap<String, f64>,
    alias_rules: Vec<AliasRuleFile>,
}

#[derive(Deserialize)]
struct SupplementRates {
    input_per_million: f64,
    output_per_million: f64,
    #[serde(default)]
    cache_write_per_million: Option<f64>,
    #[serde(default)]
    cache_read_per_million: Option<f64>,
}

#[derive(Deserialize)]
struct AliasRuleFile {
    pattern: String,
    canonical: String,
}

#[derive(Deserialize)]
struct CompactCatalog {
    models: HashMap<String, CompactModel>,
}

#[derive(Deserialize)]
struct CompactModel {
    i: f64,
    o: f64,
    cw: f64,
    cr: f64,
    #[serde(default)]
    ia: Option<f64>,
    #[serde(default)]
    oa: Option<f64>,
    #[serde(default)]
    cwa: Option<f64>,
    #[serde(default)]
    cra: Option<f64>,
    #[serde(default)]
    fast: Option<f64>,
}

pub struct ModelPricing {
    supplement: PricingSupplement,
    primary: HashMap<String, ModelRates>,
}

static DEFAULT_PRICING: OnceLock<ModelPricing> = OnceLock::new();

pub fn default_pricing() -> &'static ModelPricing {
    DEFAULT_PRICING.get_or_init(ModelPricing::from_bundled)
}

impl ModelPricing {
    pub fn from_bundled() -> Self {
        let supplement = load_supplement(SUPPLEMENT_JSON);
        let primary = load_compact_catalog(LITELLM_JSON);
        Self { supplement, primary }
    }

    pub fn can_price(&self, model: &str) -> bool {
        self.resolve(model).is_some()
    }

    pub fn estimated_cost_dollars(&self, model: &str, tokens: &TokenBreakdown) -> Option<f64> {
        self.resolve(model).map(|r| r.cost_dollars(tokens))
    }

    pub fn resolve(&self, model: &str) -> Option<ModelRates> {
        if let Some(canonical) = self.supplement.canonical_name(model) {
            if canonical != model {
                if let Some(r) = self.lookup(&canonical) {
                    return Some(r);
                }
            }
        }
        self.lookup(model)
    }

    fn lookup(&self, name: &str) -> Option<ModelRates> {
        if let Some(r) = self.supplement.pricing.get(name) {
            return Some(r.clone());
        }
        if let Some(r) = self.primary.get(name) {
            return Some(r.clone());
        }
        if let Some(r) = self.fast_variant(name) {
            return Some(r);
        }
        self.fuzzy_primary(name)
    }

    fn fast_variant(&self, name: &str) -> Option<ModelRates> {
        const SUFFIX: &str = "-fast";
        if !name.ends_with(SUFFIX) {
            return None;
        }
        let base = &name[..name.len() - SUFFIX.len()];
        if base.is_empty() {
            return None;
        }
        let (key, rates) = self.base_entry(base)?;
        let multiplier = if rates.fast_multiplier != 1.0 {
            rates.fast_multiplier
        } else {
            self.supplement
                .fast_multiplier(&key)
                .or_else(|| self.supplement.fast_multiplier(base))?
        };
        Some(rates.scaled(multiplier))
    }

    fn base_entry(&self, base: &str) -> Option<(String, ModelRates)> {
        if let Some(r) = self.supplement.pricing.get(base) {
            return Some((base.to_string(), r.clone()));
        }
        self.primary
            .get(base)
            .map(|r| (base.to_string(), r.clone()))
            .or_else(|| self.fuzzy_primary(base).map(|r| (base.to_string(), r)))
    }

    fn fuzzy_primary(&self, model: &str) -> Option<ModelRates> {
        let normalized = normalized_key(model);
        let mut best: Option<(&str, &ModelRates)> = None;
        for (key, rates) in &self.primary {
            if key_matches(key, model, &normalized) {
                best = match best {
                    Some((bk, _)) if key.len() > bk.len() || (key.len() == bk.len() && key.as_str() < bk) => {
                        Some((key.as_str(), rates))
                    }
                    Some(current) => Some(current),
                    None => Some((key.as_str(), rates)),
                };
            }
        }
        best.map(|(_, r)| r.clone())
    }
}

impl PricingSupplement {
    fn canonical_name(&self, model: &str) -> Option<String> {
        for rule in &self.alias_rules {
            if rule.pattern.is_match(model) {
                return Some(rule.canonical.clone());
            }
        }
        None
    }

    fn fast_multiplier(&self, model: &str) -> Option<f64> {
        if let Some(v) = self.fast_multipliers.get(model) {
            return Some(*v);
        }
        let normalized = normalized_key(model);
        for part in normalized.split(['/', ':']) {
            for (base, mult) in &self.fast_multipliers {
                if matches_model_suffix(part, &normalized_key(base)) {
                    return Some(*mult);
                }
            }
        }
        None
    }
}

fn load_supplement(json: &str) -> PricingSupplement {
    let file: SupplementFile = serde_json::from_str(json).unwrap_or(SupplementFile {
        pricing: HashMap::new(),
        fast_multipliers: HashMap::new(),
        alias_rules: vec![],
    });
    let mut pricing = HashMap::new();
    for (model, entry) in file.pricing {
        pricing.insert(
            model,
            ModelRates {
                input_per_million: entry.input_per_million,
                output_per_million: entry.output_per_million,
                cache_write_per_million: entry
                    .cache_write_per_million
                    .unwrap_or(entry.input_per_million),
                cache_read_per_million: entry
                    .cache_read_per_million
                    .unwrap_or(entry.input_per_million * 0.1),
                input_above_200k: None,
                output_above_200k: None,
                cache_write_above_200k: None,
                cache_read_above_200k: None,
                fast_multiplier: 1.0,
            },
        );
    }
    let alias_rules = file
        .alias_rules
        .into_iter()
        .filter_map(|rule| {
            Regex::new(&rule.pattern)
                .ok()
                .map(|pattern| AliasRule {
                    pattern,
                    canonical: rule.canonical,
                })
        })
        .collect();
    PricingSupplement {
        pricing,
        fast_multipliers: file.fast_multipliers,
        alias_rules,
    }
}

fn load_compact_catalog(json: &str) -> HashMap<String, ModelRates> {
    let file: CompactCatalog = serde_json::from_str(json).unwrap_or(CompactCatalog {
        models: HashMap::new(),
    });
    file.models
        .into_iter()
        .map(|(key, m)| {
            (
                key,
                ModelRates {
                    input_per_million: m.i,
                    output_per_million: m.o,
                    cache_write_per_million: m.cw,
                    cache_read_per_million: m.cr,
                    input_above_200k: m.ia,
                    output_above_200k: m.oa,
                    cache_write_above_200k: m.cwa,
                    cache_read_above_200k: m.cra,
                    fast_multiplier: m.fast.unwrap_or(1.0),
                },
            )
        })
        .collect()
}

fn normalized_key(model: &str) -> String {
    model.to_ascii_lowercase()
}

fn key_matches(candidate: &str, model: &str, normalized_model: &str) -> bool {
    let nc = normalized_key(candidate);
    normalized_model.contains(&nc)
        || normalized_key(model).contains(&nc)
        || model.contains(candidate)
}

fn matches_model_suffix(part: &str, base: &str) -> bool {
    part.rfind(base)
        .map(|idx| {
            let suffix = &part[idx + base.len()..];
            suffix.is_empty() || suffix.starts_with('-')
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_pricing_resolves_claude_sonnet() {
        let p = ModelPricing::from_bundled();
        assert!(p.can_price("claude-sonnet-4-20250514"));
    }

    #[test]
    fn opus_fast_override_from_supplement() {
        let p = ModelPricing::from_bundled();
        let rates = p.resolve("claude-opus-4-7-fast").expect("opus fast");
        assert!((rates.input_per_million - 30.0).abs() < 0.01);
    }

    #[test]
    fn gpt_5_6_aliases_resolve() {
        let p = ModelPricing::from_bundled();
        assert!(p.can_price("gpt-5.6-sol"));
        assert!(p.can_price("gpt-5.6-terra-fast"));
        assert!(p.can_price("gpt-5.6-luna"));
    }

    #[test]
    fn grok_4_5_and_kimi_k2_7_aliases() {
        let p = ModelPricing::from_bundled();
        let grok = p.resolve("grok-4.5-fast-high").expect("grok fast high");
        let grok_fast = p.resolve("grok-4.5-fast").expect("grok fast");
        assert!((grok.input_per_million - grok_fast.input_per_million).abs() < 0.01);
        assert!(p.can_price("kimi-k2.7-code"));
        assert!(p.can_price("kimi-k2p7"));
    }

    #[test]
    fn request_wide_long_context_uses_higher_tier_for_all_fields() {
        let rates = ModelRates {
            input_per_million: 1.0,
            output_per_million: 2.0,
            cache_write_per_million: 1.0,
            cache_read_per_million: 0.1,
            input_above_200k: Some(10.0),
            output_above_200k: Some(20.0),
            cache_write_above_200k: Some(10.0),
            cache_read_above_200k: Some(1.0),
            fast_multiplier: 1.0,
        };
        let tokens = TokenBreakdown {
            input: 150_000,
            output: 1_000,
            cache_write5m: 40_000,
            cache_write1h: 0,
            cache_read: 20_000,
            is_fast: false,
        };
        // prompt = 210k → whole request at long-context rates
        let cost = rates.cost_dollars(&tokens);
        let expected = flat_cost(150_000, 10.0)
            + flat_cost(1_000, 20.0)
            + flat_cost(40_000, 10.0)
            + flat_cost(20_000, 1.0);
        assert!((cost - expected).abs() < 1e-9);
        let short = rates.cost_dollars_with_options(
            &TokenBreakdown {
                input: 1_000,
                output: 1_000,
                cache_write5m: 0,
                cache_write1h: 0,
                cache_read: 0,
                is_fast: false,
            },
            true,
        );
        assert!((short - flat_cost(1_000, 1.0) - flat_cost(1_000, 2.0)).abs() < 1e-9);
    }
}
