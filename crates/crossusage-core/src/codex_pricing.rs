//! Codex-specific spend math (upstream OpenUsage 0.7.6 #995).

use crate::log_usage_types::TokenBreakdown;
use crate::model_pricing::{ModelPricing, ModelRates};

pub struct CodexCostInput<'a> {
    pub model: &'a str,
    pub input: i32,
    pub cached: i32,
    pub output: i32,
    pub reasoning: i32,
    pub is_fast: bool,
    /// Codex Ultrafast service tier. GPT-6 Astra prices this at 6x, not the 2x fast tier.
    pub is_ultrafast: bool,
}

fn dated_base_model(model: &str) -> String {
    let re_ymd = regex_lite::Regex::new(r"-\d{4}-\d{2}-\d{2}$").expect("ymd");
    let re_ymd8 = regex_lite::Regex::new(r"-\d{8}$").expect("ymd8");
    let s = re_ymd.replace(model, "");
    re_ymd8.replace(&s, "").into_owned()
}

fn codex_priority_multiplier(model: &str, rates: &ModelRates) -> f64 {
    match dated_base_model(model).as_str() {
        "gpt-5.5" | "gpt-5.5-pro" => 2.5,
        "gpt-5.4" | "gpt-5.4-pro" | "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna"
        | "gpt-6-astra" | "gpt-6.1-sol" | "gpt-6-sol" | "gpt-6-luna" => 2.0,
        _ if (rates.fast_multiplier - 1.0).abs() < f64::EPSILON => 2.0,
        _ => rates.fast_multiplier,
    }
}

fn codex_model_has_no_cache_discount(model: &str) -> bool {
    matches!(
        dated_base_model(model).as_str(),
        "gpt-5.4-pro" | "gpt-5.5-pro"
    )
}

fn codex_long_context_rates(model: &str) -> Option<(f64, f64, f64)> {
    match dated_base_model(model).as_str() {
        "gpt-5.4" => Some((5.0, 22.5, 0.5)),
        "gpt-5.4-pro" => Some((60.0, 270.0, 60.0)),
        "gpt-5.5" => Some((10.0, 45.0, 1.0)),
        "gpt-5.5-pro" => Some((60.0, 270.0, 60.0)),
        "gpt-5.6-sol" => Some((8.0, 30.0, 0.8)),
        "gpt-5.6-terra" => Some((4.0, 18.0, 0.4)),
        "gpt-5.6-luna" => Some((0.4, 1.8, 0.04)),
        // Above 272k: 2x input and cache, 1.5x output.
        "gpt-6-astra" => Some((20.0, 75.0, 2.0)),
        "gpt-6.1-sol" => Some((4.0, 15.0, 0.2)),
        "gpt-6-sol" => Some((4.0, 15.0, 0.4)),
        "gpt-6-luna" => Some((0.2, 0.75, 0.02)),
        _ => None,
    }
}

/// Non-cached input + explicit cache-read (or full input), output+reasoning, 272k tier, priority mult.
pub fn estimated_cost_dollars(pricing: &ModelPricing, event: &CodexCostInput<'_>) -> Option<f64> {
    let trimmed = event.model.trim();
    if trimmed.is_empty() {
        return None;
    }
    let canonical = pricing
        .canonical_name(trimmed)
        .unwrap_or_else(|| trimmed.to_string());
    let is_fast_alias = canonical.ends_with("-fast");
    let rate_model = if is_fast_alias {
        canonical.trim_end_matches("-fast").to_string()
    } else {
        canonical
    };
    let base_rates = pricing.resolve(&rate_model);
    let mut rates = base_rates.clone().or_else(|| pricing.resolve(trimmed))?;
    let applies_codex_fast = if is_fast_alias {
        base_rates.is_some()
    } else {
        event.is_fast || event.is_ultrafast
    };

    if let Some((input, output, cache_read)) = codex_long_context_rates(&rate_model) {
        rates.input_above_200k = Some(input);
        rates.output_above_200k = Some(output);
        rates.cache_read_above_200k = Some(cache_read);
        rates.long_context_threshold_tokens = 272_000;
    }
    if codex_model_has_no_cache_discount(&rate_model) || !rates.cache_read_is_explicit {
        rates.cache_read_per_million = rates.input_per_million;
        rates.cache_read_above_200k = rates.input_above_200k;
    }
    rates.fast_multiplier = if event.is_ultrafast && dated_base_model(&rate_model) == "gpt-6-astra" {
        6.0
    } else {
        codex_priority_multiplier(&rate_model, &rates)
    };

    let non_cached = (event.input - event.cached).max(0);
    let tokens = TokenBreakdown {
        input: non_cached,
        cache_write5m: 0,
        cache_write1h: 0,
        cache_read: event.cached,
        output: event.output + event.reasoning,
        is_fast: applies_codex_fast,
    };
    Some(rates.cost_dollars(&tokens))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_pricing::ModelPricing;

    #[test]
    fn fast_alias_unwraps_base_rates() {
        let pricing = ModelPricing::from_bundled();
        let cost = estimated_cost_dollars(
            &pricing,
            &CodexCostInput {
                model: "gpt-5.5-fast",
                input: 1_000,
                cached: 0,
                output: 100,
                reasoning: 0,
                is_fast: false,
                is_ultrafast: false,
            },
        );
        assert!(cost.is_some());
    }

    #[test]
    fn ultrafast_astra_uses_six_times_priority() {
        let pricing = ModelPricing::from_bundled();
        let base = estimated_cost_dollars(
            &pricing,
            &CodexCostInput {
                model: "gpt-6-astra",
                input: 1_000_000,
                cached: 0,
                output: 0,
                reasoning: 0,
                is_fast: false,
                is_ultrafast: false,
            },
        )
        .expect("base");
        let ultra = estimated_cost_dollars(
            &pricing,
            &CodexCostInput {
                model: "gpt-6-astra",
                input: 1_000_000,
                cached: 0,
                output: 0,
                reasoning: 0,
                is_fast: false,
                is_ultrafast: true,
            },
        )
        .expect("ultra");
        assert!((ultra / base - 6.0).abs() < 0.01, "ultra {ultra} base {base}");
    }

    #[test]
    fn sol_promo_long_context_is_two_times_input_and_1_5_output() {
        let pricing = ModelPricing::from_bundled();
        let short = estimated_cost_dollars(
            &pricing,
            &CodexCostInput {
                model: "gpt-5.6-sol",
                input: 100_000,
                cached: 0,
                output: 100_000,
                reasoning: 0,
                is_fast: false,
                is_ultrafast: false,
            },
        )
        .expect("short");
        // Promo base 4 / 20 → 100k in + 100k out = $2.40
        assert!((short - 2.4).abs() < 0.01, "short {short}");

        let long = estimated_cost_dollars(
            &pricing,
            &CodexCostInput {
                model: "gpt-5.6-sol",
                input: 273_000,
                cached: 0,
                output: 273_000,
                reasoning: 0,
                is_fast: false,
                is_ultrafast: false,
            },
        )
        .expect("long");
        // Above 272k: 2x input (8) and 1.5x output (30)
        let expected = 273_000.0 * (8.0 + 30.0) / 1_000_000.0;
        assert!((long - expected).abs() < 0.01, "long {long} expected {expected}");
    }
}
