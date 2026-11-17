# Default recipe: list available commands
default:
    @just --list

# Start platform dev server (portless: http://cf-app.localhost:1355)
dev:
    @portless --force cf-app nub run dev
