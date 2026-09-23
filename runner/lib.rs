use serde::{Deserialize, Serialize};
use zega::{check_zql, Zega, ZqlEntryPoint};

#[derive(Deserialize)]
pub struct Request {
    pub source: String,
    pub api: String,
    #[serde(default)]
    pub sources: Option<std::collections::HashMap<String, String>>,
}

#[derive(Serialize)]
pub struct Outcome {
    pub ok: bool,
    pub stage: &'static str,
    pub stdout: String,
    pub stderr: String,
}

fn parse_error(rendered: String) -> Outcome {
    Outcome {
        ok: false,
        stage: "parse",
        stdout: String::new(),
        stderr: format!("{rendered}\n"),
    }
}

/// Both hosts use the same adapter, including serialization. Arrays retain engine
/// order; serde_json's default map sorts object keys, without dropping any fields.
pub fn evaluate(request: Request) -> Result<Outcome, String> {
    let source = &request.source;
    let entry_point = match request.api.as_str() {
        "file" => ZqlEntryPoint::File,
        "query" => ZqlEntryPoint::Query,
        "statement" => ZqlEntryPoint::Statement,
        _ => return Err(format!("unknown parser API: {}", request.api)),
    };
    if let Err(rendered) = check_zql(entry_point, source) {
        return Ok(parse_error(rendered));
    }
    if request.api != "file" {
        return Err("parser API cases must exercise a rejected input".into());
    }
    let db = Zega::in_memory().build().map_err(|e| e.to_string())?;
    let result = match request.sources {
        Some(sources) => db.apply_zql_with_sources(source, &sources),
        None => db.apply_zql(source),
    };
    Ok(match result {
        Ok(value) => Outcome {
            ok: true,
            stage: "run",
            stdout: format!(
                "{}\n",
                serde_json::to_string(&value).map_err(|e| e.to_string())?
            ),
            stderr: String::new(),
        },
        Err(error) => Outcome {
            ok: false,
            stage: "run",
            stdout: String::new(),
            stderr: format!("{error}\n"),
        },
    })
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn evaluate_json(request: &str) -> Result<String, wasm_bindgen::JsValue> {
    let request = serde_json::from_str(request)
        .map_err(|e| wasm_bindgen::JsValue::from_str(&e.to_string()))?;
    let outcome = evaluate(request).map_err(|e| wasm_bindgen::JsValue::from_str(&e))?;
    serde_json::to_string(&outcome).map_err(|e| wasm_bindgen::JsValue::from_str(&e.to_string()))
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn import_locations(source: &str) -> String {
    // Parsing or policy errors are rendered by evaluate_json, with the same
    // stage and diagnostic as native. Never fetch on those paths.
    let locations = zega::zql_load_locations(ZqlEntryPoint::File, source).unwrap_or_default();
    serde_json::to_string(&locations).expect("locations serialize")
}
