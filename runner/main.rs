use std::io::{self, Read};

fn main() {
    if let Err(error) = run() {
        eprintln!("host infrastructure error: {error}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let request = serde_json::from_str(&input)?;
    let outcome = zql_conformance_host::evaluate(request)?;
    println!("{}", serde_json::to_string(&outcome)?);
    Ok(())
}
