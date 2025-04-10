/**
 * PredictionSystem.js
 * 
 * This system handles client-side prediction and server reconciliation for networked physics.
 * It maintains a buffer of player inputs and predictions, and reconciles them with server state.
 */
import * as THREE from 'three';
import { log, error } from '../debug.js';

export class PredictionSystem {
    constructor(game) {
        this.game = game;
        this.inputSequence = 0;
        this.pendingInputs = [];
        this.lastProcessedInput = -1;

        // Thresholds for position reconciliation
        this.positionReconciliationThreshold = 0.2; // Further increased threshold
        this.velocityDampingThreshold = 0.1;

        // State tracking
        this.reconciliationEnabled = true;
        this.predictionEnabled = true;
        this.debugMode = false;
        this.isJumping = false;
        this.jumpCooldown = false;
        this.jumpStartTime = 0;

        // Interpolation factors for smoother corrections
        this.correctionFactorGround = 0.15; // Reverted to original baseline
        this.correctionFactorAir = 0.1; // Reverted to original baseline

        // Velocity interpolation factor for smoother acceleration/deceleration
        this.velocityInterpolationFactor = 0.2; // Adjust for desired responsiveness vs smoothness
        this.stopDampingFactor = 0.9; // How quickly the player stops (closer to 1 = slower stop)

        // Movement constants
        this.MOVE_SPEED = 15;
        this.JUMP_FORCE = 10;

        // Last input time tracking
        this.lastInputAppliedTime = 0;
        this.noInputDuration = 0;
        this.velocityDampingActive = false;
        this.lastMovementInput = null;

        // Statistics
        this.reconciliationCount = 0;
        this.lastReconciliationTime = 0;
        this.averageCorrection = { x: 0, y: 0, z: 0 };
    }

    /**
     * Process a player input and add it to the pending inputs buffer
     * @param {Object} input - The player input to process
     * @param {Number} deltaTime - The time elapsed since the last frame
     * @returns {Number} The sequence number assigned to this input
     */
    processInput(input, deltaTime) {
        if (!this.game.player || !this.predictionEnabled) return -1;

        this.inputSequence++;

        // Track if this is a movement input
        const isMovementInput = input.movement && (
            input.movement.forward ||
            input.movement.backward ||
            input.movement.left ||
            input.movement.right
        );

        // Store last movement input state
        this.lastMovementInput = isMovementInput ? input.movement : null;

        // Apply input immediately for responsiveness
        this.applyInput(input, deltaTime);

        // Store input for reconciliation
        const playerPosition = this.game.player.getPosition();
        this.pendingInputs.push({
            sequence: this.inputSequence,
            input,
            position: { ...playerPosition },
            timestamp: Date.now()
        });

        // Keep only last 1 second of inputs
        const currentTime = Date.now();
        this.pendingInputs = this.pendingInputs.filter(
            input => currentTime - input.timestamp < 1000
        );

        return this.inputSequence;
    }

    /**
     * Apply an input to the local player - handles actual movement
     * @param {Object} input - The input to apply
     * @param {Number} deltaTime - The time elapsed since the last frame
     * @param {Boolean} isReconciliation - Flag indicating if called during reconciliation
     */
    applyInput(input, deltaTime, isReconciliation = false) {
        if (!this.game.player || !this.game.player.body) return;

        // --- DEBUG LOG: Log received input state ---
        // console.log(`[applyInput] Received input: ${JSON.stringify(input)}`);

        try {
            // --- Ensure physics body is active --- 
            if (this.game.player.body && !this.game.player.body.isActive()) {
                console.log('[applyInput] Reactivating physics body.');
                this.game.player.body.activate(true);
            }

            // Handle movement
            if (input.movement) {
                const direction = { x: 0, z: 0 };

                if (input.movement.forward) direction.z -= 1;
                if (input.movement.backward) direction.z += 1;
                if (input.movement.left) direction.x -= 1;
                if (input.movement.right) direction.x += 1;

                // Get camera direction for movement relative to view
                const camera = this.game.scene.camera;
                if (!camera) return;

                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                forward.y = 0;
                forward.normalize();

                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
                right.y = 0;
                right.normalize();

                // Calculate movement direction
                const finalDirection = new THREE.Vector3();
                if (direction.x !== 0 || direction.z !== 0) {
                    finalDirection.addScaledVector(forward, -direction.z);
                    finalDirection.addScaledVector(right, direction.x);
                    finalDirection.normalize();

                    // Get current velocity
                    const velocity = this.game.player.body.getLinearVelocity();
                    const currentVelY = velocity.y();
                    const currentVelX = velocity.x();
                    const currentVelZ = velocity.z();

                    // Calculate target velocity
                    const targetVelX = finalDirection.x * this.MOVE_SPEED;
                    const targetVelZ = finalDirection.z * this.MOVE_SPEED;

                    // Smoothly interpolate towards target velocity
                    const interpFactor = this.velocityInterpolationFactor;
                    const newVelX = currentVelX + (targetVelX - currentVelX) * interpFactor;
                    const newVelZ = currentVelZ + (targetVelZ - currentVelZ) * interpFactor;

                    // Set interpolated velocity
                    const newVelocity = new Ammo.btVector3(
                        newVelX,
                        currentVelY,
                        newVelZ
                    );
                    this.game.player.body.setLinearVelocity(newVelocity);
                    Ammo.destroy(newVelocity);

                    // Update last input time
                    this.lastInputAppliedTime = Date.now();
                    this.noInputDuration = 0;
                    this.velocityDampingActive = false;

                    // -- Set Movement Intent on Player (gated by !isReconciliation) --
                    if (!isReconciliation && this.game.player) {
                        // Instead of calling updateMovementAnimation directly,
                        // set the intent on the player object.
                        this.game.player.setMovementIntent(input.movement);
                    }
                } else {
                    // No local direction (WASD keys released *this frame*)
                    // Don't stop movement if player is currently attacking
                    if (!this.game.player.isAttacking) {
                        this.stopMovement();
                    }
                }
            } else {
                // No input.movement object provided at all?
                // Don't stop movement if player is currently attacking
                if (!this.game.player.isAttacking) {
                    this.stopMovement();
                }
            }

            // Handle jumping
            if (input.jump && !this.isJumping && !this.jumpCooldown && this.game.isPlayerOnGround()) {
                this.isJumping = true;
                this.jumpStartTime = Date.now();
                this.game.player.jump();

                // Send jump event to server
                if (this.game.networkManager?.connected) {
                    this.game.networkManager.sendJump();
                }

                // Set jump cooldown
                this.jumpCooldown = true;
                setTimeout(() => {
                    this.jumpCooldown = false;
                }, 500);

                // Reset jump state after animation
                setTimeout(() => {
                    this.isJumping = false;
                    this.game.player.checkGroundContact();
                }, 1000);
            }
        } catch (err) {
            error('Error in applyInput:', err);
        }
    }

    /**
     * Immediately stop player movement
     */
    stopMovement() {
        if (!this.game.player || !this.game.player.body) return;

        const velocity = this.game.player.body.getLinearVelocity();
        const currentVelX = velocity.x();
        const currentVelY = velocity.y();
        const currentVelZ = velocity.z();

        // Gradually damp horizontal velocity
        const newVelX = currentVelX * this.stopDampingFactor;
        const newVelZ = currentVelZ * this.stopDampingFactor;

        // Stop completely if velocity is very small
        const stopThreshold = 0.1;
        const finalVelX = Math.abs(newVelX) < stopThreshold ? 0 : newVelX;
        const finalVelZ = Math.abs(newVelZ) < stopThreshold ? 0 : newVelZ;

        const newVelocity = new Ammo.btVector3(
            finalVelX,
            currentVelY, // Preserve vertical velocity
            finalVelZ
        );
        this.game.player.body.setLinearVelocity(newVelocity);
        Ammo.destroy(newVelocity);
        this.velocityDampingActive = true;

        // Ensure idle animation is played when stopping
        if (this.game.player) {
            // Also set intent to idle when stopping explicitly
            this.game.player.setMovementIntent({ isMoving: false });
        }
    }

    /**
     * Handle velocity damping when no input is detected
     * This prevents the "sliding" effect after releasing movement keys
     */
    updateInputDamping() {
        if (!this.game.player || !this.game.player.body) return;

        const now = Date.now();
        this.noInputDuration = now - this.lastInputAppliedTime;

        // If no movement input is active, ensure player is stopped
        if (!this.lastMovementInput && this.game.isPlayerOnGround() && !this.velocityDampingActive) {
            this.stopMovement();
        }
    }

    /**
     * Process a server state update and reconcile if needed
     * @param {Object} serverState - The server state to reconcile with
     */
    processServerUpdate(serverState) {
        if (!this.game.player || !this.reconciliationEnabled) return;

        const playerState = serverState.players[this.game.networkManager.playerId];
        if (!playerState) return;

        // Handle server acknowledgment
        if (typeof playerState.lastProcessedInput === 'number' &&
            playerState.lastProcessedInput > this.lastProcessedInput) {
            this.pendingInputs = this.pendingInputs.filter(
                input => input.sequence > playerState.lastProcessedInput
            );
            this.lastProcessedInput = playerState.lastProcessedInput;
        }

        // Position reconciliation
        const serverPos = playerState.position;
        const clientPos = this.game.player.getPosition();

        const dx = serverPos.x - clientPos.x;
        const dy = serverPos.y - clientPos.y;
        const dz = serverPos.z - clientPos.z;

        const distanceSquared = dx * dx + dy * dy + dz * dz;

        // Only reconcile if difference is significant
        if (distanceSquared > this.positionReconciliationThreshold * this.positionReconciliationThreshold) {
            // Use different correction factors for ground vs air
            const correctionFactor = this.game.isPlayerOnGround() ?
                this.correctionFactorGround : this.correctionFactorAir;

            // Smoothly interpolate to server position
            const newPosition = {
                x: clientPos.x + dx * correctionFactor,
                y: clientPos.y + dy * correctionFactor, // Smooth Y interpolation
                z: clientPos.z + dz * correctionFactor
            };

            this.game.player.setPosition(newPosition);

            // Track reconciliation stats
            this.reconciliationCount++;
            this.lastReconciliationTime = Date.now();
            this.averageCorrection = {
                x: dx,
                y: dy,
                z: dz
            };

            // Reapply pending inputs without triggering animations directly
            for (const inputData of this.pendingInputs) {
                this.applyInput(inputData.input, 1 / 60, true); // Pass true for isReconciliation
            }
        }

        // Optional: Log reconciliation details if debugging
    }

    /**
     * Update method called every frame
     * @param {Number} deltaTime - The time elapsed since the last frame
     */
    update(deltaTime) {
        // Handle stopping movement when no keys are pressed
        this.updateInputDamping();
    }

    /**
     * Get stats about the prediction system for debugging
     */
    getStats() {
        return {
            pendingInputCount: this.pendingInputs.length,
            reconciliationCount: this.reconciliationCount,
            lastReconciliationTime: this.lastReconciliationTime,
            timeSinceLastReconciliation: Date.now() - this.lastReconciliationTime,
            averageCorrection: this.averageCorrection,
            enabled: {
                prediction: this.predictionEnabled,
                reconciliation: this.reconciliationEnabled
            },
            isJumping: this.isJumping,
            noInputDuration: this.noInputDuration,
            velocityDampingActive: this.velocityDampingActive
        };
    }

    /**
     * Toggle prediction on/off
     */
    togglePrediction() {
        this.predictionEnabled = !this.predictionEnabled;
        console.log(`Client-side prediction: ${this.predictionEnabled ? 'ENABLED' : 'DISABLED'}`);
    }

    /**
     * Toggle reconciliation on/off
     */
    toggleReconciliation() {
        this.reconciliationEnabled = !this.reconciliationEnabled;
        console.log(`Server reconciliation: ${this.reconciliationEnabled ? 'ENABLED' : 'DISABLED'}`);
    }

    /**
     * Toggle debug mode on/off
     */
    toggleDebugMode() {
        this.debugMode = !this.debugMode;
        console.log(`Prediction debug mode: ${this.debugMode ? 'ENABLED' : 'DISABLED'}`);
    }
} 