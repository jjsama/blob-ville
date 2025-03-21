export class InputHandler {
    constructor() {
        this.keyStates = {};
        this.mousePosition = { x: 0, y: 0 };
        this.callbacks = {
            keyDown: [],
            keyUp: [],
            mouseMove: [],
            mouseDown: [],
            mouseUp: []
        };
        this.mouseButtons = new Map();
        
        // Add specific key tracking for common game controls
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            attack: false
        };
    }

    init() {
        // Prevent default behavior for game control keys
        const gameKeys = ['w', 'a', 's', 'd', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        
        window.addEventListener('keydown', (event) => {
            // Store the raw key state
            this.keyStates[event.key] = true;
            
            // Update specific key tracking
            this.updateKeyState(event.key, true);
            
            // Prevent scrolling when pressing space
            if (gameKeys.includes(event.key)) {
                event.preventDefault();
            }
            
            // Call callbacks
            this.callbacks.keyDown.forEach(callback => callback(event));
        });

        window.addEventListener('keyup', (event) => {
            // Store the raw key state
            this.keyStates[event.key] = false;
            
            // Update specific key tracking
            this.updateKeyState(event.key, false);
            
            // Call callbacks
            this.callbacks.keyUp.forEach(callback => callback(event));
        });

        window.addEventListener('mousemove', (event) => {
            this.mousePosition.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mousePosition.y = -(event.clientY / window.innerHeight) * 2 + 1;
            this.callbacks.mouseMove.forEach(callback => callback(event));
        });

        window.addEventListener('mousedown', (event) => {
            this.mouseButtons.set(event.button, true);
            this.callbacks.mouseDown.forEach(callback => callback(event));
        });

        window.addEventListener('mouseup', (event) => {
            this.mouseButtons.set(event.button, false);
            this.callbacks.mouseUp.forEach(callback => callback(event));
        });
        
        // Prevent context menu on right-click
        window.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
        
        // Handle focus/blur to prevent stuck keys
        window.addEventListener('blur', () => {
            this.resetKeys();
        });
    }
    
    // Update the specific key tracking
    updateKeyState(key, isPressed) {
        // Movement keys
        if (key === 'w' || key === 'W' || key === 'ArrowUp') {
            this.keys.forward = isPressed;
        }
        if (key === 's' || key === 'S' || key === 'ArrowDown') {
            this.keys.backward = isPressed;
        }
        if (key === 'a' || key === 'A' || key === 'ArrowLeft') {
            this.keys.left = isPressed;
        }
        if (key === 'd' || key === 'D' || key === 'ArrowRight') {
            this.keys.right = isPressed;
        }
        
        // Action keys
        if (key === ' ') {
            this.keys.jump = isPressed;
        }
        if (key === 'e' || key === 'E') {
            this.keys.attack = isPressed;
        }
    }
    
    // Reset all keys (useful when window loses focus)
    resetKeys() {
        Object.keys(this.keys).forEach(key => {
            this.keys[key] = false;
        });
        
        this.keyStates = {};
        this.mouseButtons.clear();
    }

    isKeyPressed(key) {
        return this.keyStates[key] === true;
    }
    
    // Get the current input state for game controls
    getInputState() {
        return {
            forward: this.keys.forward,
            backward: this.keys.backward,
            left: this.keys.left,
            right: this.keys.right,
            jump: this.keys.jump,
            attack: this.keys.attack,
            mousePosition: this.mousePosition,
            mouseButtons: Object.fromEntries(this.mouseButtons)
        };
    }

    onKeyDown(callback) {
        this.callbacks.keyDown.push(callback);
    }

    onKeyUp(callback) {
        this.callbacks.keyUp.push(callback);
    }

    onMouseMove(callback) {
        this.callbacks.mouseMove.push(callback);
    }

    onMouseDown(callback) {
        this.callbacks.mouseDown.push(callback);
    }

    onMouseUp(callback) {
        this.callbacks.mouseUp.push(callback);
    }
} 