import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Configuração otimizada para o Monorepo + Tauri v2
export default defineConfig({
  plugins: [react()],
  // Impede que o Vite limpe o terminal para não perdermos os logs do Rust
  clearScreen: false,
  server: {
    port: 5173,
    // Força o Vite a falhar se a porta 5173 estiver ocupada, em vez de pular 
    // para a 5174, garantindo que o Tauri sempre encontre o frontend
    strictPort: true,
  }
})