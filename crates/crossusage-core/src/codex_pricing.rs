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
        "gpt-5.4" | "gpt-5.4-pro" | "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna" => 2.0,
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
        "gpt-5.6-sol" => Some((10.0, 45.0, 1.0)),
        "gpt-5.6-terra" => Some((5.0, 22.5, 0.5)),
        "gpt-5.6-luna" => Some((2.0, 9.0, 0.2)),
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
        event.is_fast
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
    rates.fast_multiplier = codex_priority_multiplier(&rate_model, &rates);

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
            },
        );
        assert!(cost.is_some());
    }
}
