# Diagnostic coverage audit

Audited against `zega-lang/src/lib.rs` at engine commit `718349d94673552f848d1abd7046a98496a5747a`. The corpus pins the entire rendered diagnostic in each `.stderr`, not just the message shown below. There are no wildcard or substring matches in the runner.

## Parser-emitted messages

Every externally reachable parser message family has a rejecting case. Parameterized families (`expected {token}`, `bad number {text}`, type/field names, ranges, and serde JSON details) have representative concrete values; the suite does not claim every possible interpolated value. Both comma and single-ampersand AND diagnostics are covered because their help text differs.

| Case | Pinned message |
| --- | --- |
| [errors/expected_schema](tests/errors/expected_schema) | expected schema |
| [schema/empty_schema](tests/schema/empty_schema) | schema has no types |
| [schema/duplicate_type](tests/schema/duplicate_type) | duplicate type Person |
| [schema/unknown_edge_target](tests/schema/unknown_edge_target) | Person.friend points at unknown type Ghost |
| [schema/edge_field_mismatch](tests/schema/edge_field_mismatch) | R fields do not match |
| [schema/optional_relationship](tests/schema/optional_relationship) | friend cannot be optional and a relationship |
| [schema/optional_missing_type](tests/schema/optional_missing_type) | name? needs a type |
| [schema/duplicate_edge_field](tests/schema/duplicate_edge_field) | duplicate edge field year |
| [schema/expected_arrow](tests/schema/expected_arrow) | expected -> or <- |
| [errors/expected_type_keyword](tests/errors/expected_type_keyword) | expected type |
| [errors/expected_open_brace](tests/errors/expected_open_brace) | expected { |
| [errors/expected_close_brace](tests/errors/expected_close_brace) | expected } |
| [errors/expected_colon](tests/errors/expected_colon) | expected : |
| [errors/expected_close_paren](tests/errors/expected_close_paren) | expected ) |
| [errors/expected_range_separator](tests/errors/expected_range_separator) | expected .. |
| [errors/expected_with](tests/errors/expected_with) | expected WITH |
| [errors/expected_name](tests/errors/expected_name) | expected a name |
| [errors/expected_name_eof](tests/errors/expected_name_eof) | expected a name |
| [errors/query_and_mutation](tests/errors/query_and_mutation) | a statement is a query or a mutation |
| [errors/load_inline](tests/errors/load_inline) | a load reads a file |
| [errors/load_missing_location](tests/errors/load_missing_location) | a load reads a file |
| [errors/load_empty_locations](tests/errors/load_empty_locations) | a load reads a file |
| [errors/load_empty_path](tests/errors/load_empty_path) | a load reads a file |
| [errors/load_non_string](tests/errors/load_non_string) | a load reads a file |
| [errors/bad_json](tests/errors/bad_json) | bad json: trailing comma at line 1 column 6 |
| [errors/hops_write](tests/errors/hops_write) | &hops is measured, not stored |
| [errors/zero_hop_range](tests/errors/zero_hop_range) | bad range *0..2 |
| [errors/reversed_hop_range](tests/errors/reversed_hop_range) | bad range *3..1 |
| [errors/range_without_arrow](tests/errors/range_without_arrow) | friends has a range but no arrow |
| [errors/single_or](tests/errors/single_or) | or is `&#124;&#124;` |
| [errors/single_and](tests/errors/single_and) | and is `&&` |
| [errors/comma_condition](tests/errors/comma_condition) | and is `&&` |
| [errors/bare_not](tests/errors/bare_not) | not-equal is `!=` |
| [errors/missing_comparison](tests/errors/missing_comparison) | expected a comparison after age |
| [errors/column_outside_load](tests/errors/column_outside_load) | `$` names a column or a key |
| [errors/column_missing_dollar](tests/errors/column_missing_dollar) | a column needs `$` |
| [errors/expected_string](tests/errors/expected_string) | expected a string |
| [errors/bad_string](tests/errors/bad_string) | bad string |
| [errors/unterminated_string](tests/errors/unterminated_string) | unterminated string |
| [errors/fractional_hops](tests/errors/fractional_hops) | expected an integer |
| [errors/expected_number](tests/errors/expected_number) | expected a number |
| [errors/number_overflow](tests/errors/number_overflow) | bad number 9223372036854775808 |
| [errors/unexpected_input](tests/errors/unexpected_input) | unexpected input |
| [errors/load_in_query_api](tests/errors/load_in_query_api) | a load runs as its own mutation |
| [constraints/unique_unknown_type](tests/constraints/unique_unknown_type) | unknown type Ghost |
| [constraints/unique_relationship](tests/constraints/unique_relationship) | Person.friends is a relationship |
| [constraints/unique_unknown_field](tests/constraints/unique_unknown_field) | Person has no field email |

## Defensive branches not reachable through public parser input

- `embedded_json` has an `expected json` fallback for a token stream with no value. Its only caller first requires the next input byte to be `"` or `[`, so malformed/empty input instead reaches `a load reads a file` or `bad json: …`. No public input can reach `expected json` at this revision. This is an explicit coverage exclusion, not a skipped test.
- The non-number arm of `integer` is unreachable because `number_token` returns a JSON number or an error; the reachable fractional-number arm emits the same `expected an integer` diagnostic and is covered.
- `parse_item` calls `expect("<-")` only after checking that an arrow is present and consuming `->` has failed. The diagnostic `expected <-` is unreachable; missing declaration arrows are covered by `expected -> or <-`.
- `bad number {text}` has integer and floating branches. Integer overflow is covered. The restricted floating grammar always parses as f64 (overflow becomes infinity); that error branch cannot be reached with accepted numeric tokens.

The `query` and `statement` metadata APIs exist solely to pin `a load runs as its own mutation` and `unexpected input`, which are public parser diagnostics outside full-document parsing. These cases need no graph because parsing rejects the complete input.

## Validation and execution diagnostics

These additional cases cover semantic checks, uniqueness, import validation and runtime cardinality failures. They are not counted as successful execution of an invalid query: the rejection itself, its stage, and its exact text are the assertion.

| Case | Pinned message |
| --- | --- |
| [constraints/unique_insert](tests/constraints/unique_insert) | unique Person { name } is already used |
| [constraints/unique_second_field](tests/constraints/unique_second_field) | unique Person { email } is already used |
| [constraints/unique_update](tests/constraints/unique_update) | unique Person { name } is already used |
| [errors/unknown_type](tests/errors/unknown_type) | unknown type Ghost |
| [errors/unknown_union_type](tests/errors/unknown_union_type) | unknown type Ghost |
| [errors/unknown_field](tests/errors/unknown_field) | Person has no field nmae |
| [errors/unknown_filter_field](tests/errors/unknown_filter_field) | Person has no field email |
| [errors/relationship_as_field](tests/errors/relationship_as_field) | Person has no field friends |
| [errors/set_in_query](tests/errors/set_in_query) | `set age` writes a row |
| [errors/edge_set_in_query](tests/errors/edge_set_in_query) | &since: value is stored by a mutation |
| [errors/edge_field_at_root](tests/errors/edge_field_at_root) | &since is an edge field, and this value was not reached by an edge |
| [errors/unknown_edge_field](tests/errors/unknown_edge_field) | knows has no field sinc |
| [errors/edge_field_type](tests/errors/edge_field_type) | &since is not Int |
| [errors/required_edge_field](tests/errors/required_edge_field) | knows requires &since |
| [errors/mutation_hop_range](tests/errors/mutation_hop_range) | a mutation cannot use a hop range |
| [errors/unknown_relationship](tests/errors/unknown_relationship) | Person has no relationship parent |
| [errors/wrong_direction](tests/errors/wrong_direction) | Person.friends does not point <- |
| [errors/wrong_target](tests/errors/wrong_target) | Person.friends does not reach Book |
| [errors/set_missing](tests/errors/set_missing) | no Person matched |
| [errors/set_ambiguous](tests/errors/set_ambiguous) | Person matched 3 rows |
| [errors/equality_ambiguous](tests/errors/equality_ambiguous) | Person matched 2 rows |
| [errors/link_missing](tests/errors/link_missing) | no Person matched |
| [errors/mutation_comparison](tests/errors/mutation_comparison) | creating a Person only accepts field: value |
| [errors/mutation_or](tests/errors/mutation_or) | creating a Person only accepts field: value |
| [import/missing_column](tests/import/missing_column) | no column missing |
| [import/json_scalar](tests/import/json_scalar) | json load expects an object or an array of objects |
| [import/csv_no_header](tests/import/csv_no_header) | csv has no header |
| [import/path_escape](tests/import/path_escape) | the path cannot contain .. |
| [import/private_url](tests/import/private_url) | that address points at a private network |

## Scope

This suite targets the schema/mutation/query ZQL language in `zega-lang`, not the older Cypher-like grammar in `zega-parser`. It covers every reachable parser message family plus the semantic diagnostic families in `Check`. It does not claim exhaustive operating-system I/O errors, network failures, internal graph corruption, policy/JWT errors, or every possible schema invariant. Remote unavailability is a visible skip rather than an unstable diagnostic expectation.
