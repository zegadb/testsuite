use serde::{Deserialize, Serialize};
use zega::{check_zql, Zega, ZqlEntryPoint};

#[derive(Deserialize)]
pub struct Request {
    pub source: String,
    pub api: String,
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
    Ok(match db.apply_zql(source) {
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
