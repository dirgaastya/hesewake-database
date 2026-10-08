fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=../web/dist/index.html");
    println!("cargo:rerun-if-changed=../web/dist/assets");
    tauri_build::build()
}
