# Methodology, Sources & Update Guidance

All figures are order-of-magnitude estimates. Real impact depends on model,
hardware, data-center location, cooling design, grid mix, and caching. Treat
**trends** as more reliable than absolute values, and say so when asked.

## Per-token model energy rates

Wh per million tokens (config: `rates.models`):

| Model family | Input | Output | Blended |
|---|---|---|---|
| Opus-class (largest) | 50 | 250 | ~240 |
| Sonnet-class (mid) | 30 | 150 | ~145 |
| Haiku-class (small) | 10 | 50 | ~50 |

**Prefer the two-rate formula over the blended rate.** The blended constants
deliberately sit close to the pure *output* rate, so any entry costed with them
reads high — treat those as a ceiling, not a measurement. Whenever you know the
counts, log `input_tokens` and `output_tokens` and compute each side separately.
The split cannot be recovered afterwards: solving
`energy = tokens × ((1−f)·inp + f·out) / 1e6` for the output share `f` returns
values outside `[0, 1]` for blended-rate entries, which is why the dashboard
reports split *coverage* rather than inventing one.

Basis: public estimates of per-query LLM energy (e.g. Epoch AI's ~0.3 Wh per
average ChatGPT query, 2025; Google's 2025 disclosure of ~0.24 Wh per median
Gemini text prompt) scaled by model size and typical token counts. Output
tokens cost ~5× input tokens (autoregressive generation dominates compute).
Cached input reads: ~10% of the input rate.

These are inference-only figures — they exclude model training (amortized,
small per query at scale) and embodied hardware carbon.

## Water

`water_ml = energy_wh × 1.7` (config: `rates.waterFactor`).

Source: Li et al., "Making AI Less Thirsty: Uncovering and Addressing the
Secret Water Footprint of AI Models" (2023), arXiv:2304.03271 — combined
on-site cooling + off-site power-generation water, US average. Highly
location- and cooling-dependent (evaporative vs. air cooling differ ~10×).

## Carbon

`co2e_g = energy_wh × gridIntensity / 1000` (config: `rates.gridIntensity`,
default 400 g CO2e/kWh ≈ global average, IEA *Electricity 2024*).

Regional guidance for users: hydro/nuclear-heavy grids (Norway, France,
Quebec) ~20–60; California ~250; US average ~370; coal-heavy grids (parts of
Asia, Australia) ~600–800. Providers buying renewable power can be far lower
than their local grid. Users edit this live in the dashboard's Methodology
panel.

## Real-world comparison factors

Config: `comparisons`. Phone charge ≈ 12 Wh; LED bulb 10 W; kettle boil
≈ 100 Wh; water bottle 500 mL; glass 240 mL; running tap ≈ 100 mL/s;
average car ≈ 404 g CO2/mile (US EPA Greenhouse Gas Equivalencies
Calculator) ≈ 251 g/km; a mature tree absorbs ≈ 57 g CO2/day.

## Usage grade (A+–F)

A 0–100 *optimization* score, not an absolute verdict:

- **Model efficiency (50 pts)** — effective Wh per million tokens; lighter
  models score higher
- **Session leanness (30 pts)** — average Wh per session
- **Mitigation commitment (20 pts)** — checklist completion

Tuned so an all-Opus, no-mitigation profile lands ~C ("room to improve").

## Keeping rates current

Review every ~6 months. If newer credible per-query disclosures appear
(provider sustainability reports, peer-reviewed measurements), update
`config/config.json` — the skill and the next dashboard build pick the new
values up automatically; dashboards also let users edit rates live.

## Real-life footprint factors

Config: `life`. Used only by the dashboard's Real-life footprint panel, and
surfaced with sources in its Methodology section.

| Factor | Value | Source |
|---|---|---|
| US grid intensity | 367 g CO2e/kWh | US EIA, 2023 net generation |
| Household electricity | 881 kWh/month | US EPA, Household Carbon Footprint Calculator |
| Household natural gas | 4,717 ft³/month at 0.12 lb CO2/ft³ | US EPA, same |
| Driving | 400 g CO2/mile; 4.6 t/yr at 11,500 mi and 22.2 mpg | US EPA, *GHG Emissions from a Typical Passenger Vehicle* |
| Vehicle manufacturing | ≈ 6 t CO2 (petrol sedan), ≈ 10 t (comparable EV) | lifecycle assessments; battery dominates the EV delta |
| Long-haul flight | 1.6 t CO2e per round trip | Wynes & Nicholas 2017, *Environ. Res. Lett.* 12:074024 |
| Diet | 10.24 kg CO2e/day (high meat) → 2.47 (vegan), per 2,000 kcal | Scarborough et al. 2023, *Nature Food* |

Intermediate diet groups are interpolated; low-meat uses the paper's reported
57.2% ratio. The short-haul flight figure is scaled by distance from the
transatlantic number and is the roughest value here.

### Two things this panel deliberately does not do

**It does not treat avoided emissions as offsets.** The avoided-emissions ledger
is shown beside the AI footprint and never subtracted from it. Energy consumed
cannot be un-consumed; a reduction elsewhere is a separate real-world win, not a
cancellation. Keeping a vehicle *defers* its replacement's manufacturing
emissions rather than removing them, and a much more efficient replacement can
pay that manufacturing back over time — the panel says so on the line itself.

**It does not use the "one fewer child" figure.** Wynes & Nicholas (2017) put
that at 58.6 t CO2e/year, derived by assigning a parent half of a child's
projected lifetime emissions plus a quarter of the grandchildren's and so on, at
historical emission rates that assume no decarbonisation. That accounting choice
is heavily contested, and this tool takes no position on it. Household size is
used only for what it plainly is: more people sharing the same home energy.
