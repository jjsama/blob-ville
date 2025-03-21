import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { log, error } from '../debug.js';

export class Player {
    constructor(scene, physicsWorld, position = { x: 0, y: 5, z: 0 }) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        this.position = position;
        this.mesh = null;
        this.body = null;
        this.modelLoaded = false;
        this.animations = {
            idle: null,
            walkForward: null,
            walkBackward: null,
            strafeLeft: null,
            strafeRight: null,
            jump: null,
            attack: null
        };
        this.currentAnimation = 'idle';
        this.mixer = null;
        this.currentAction = null;
        this.tempMesh = null;
        this.health = 100;
        this.isDead = false;
        this.isAttacking = false;
        this.isJumping = false;

        // Create a temporary mesh first - this ensures we always have a visible player
        this.createTempMesh();

        // Create physics body
        this.createPhysics();

        // Try to load the model, but don't wait for it
        setTimeout(() => {
            this.loadModel();
        }, 1000);

        log('Player created');
    }

    createTempMesh() {
        try {
            log('Creating temporary player model');

            // Create a simple temporary model
            const playerGroup = new THREE.Group();

            // Body
            const bodyGeometry = new THREE.CapsuleGeometry(0.5, 1, 8, 16);
            const bodyMaterial = new THREE.MeshStandardMaterial({
                color: 0x3366ff,
                roughness: 0.7,
                metalness: 0.3
            });
            const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
            body.castShadow = true;
            body.position.y = 0.5;
            playerGroup.add(body);

            // Head
            const headGeometry = new THREE.SphereGeometry(0.3, 16, 16);
            const headMaterial = new THREE.MeshStandardMaterial({
                color: 0xffcc99,
                roughness: 0.7,
                metalness: 0.2
            });
            const head = new THREE.Mesh(headGeometry, headMaterial);
            head.position.y = 1.3;
            head.castShadow = true;
            playerGroup.add(head);

            // Set position
            playerGroup.position.set(this.position.x, this.position.y, this.position.z);

            this.tempMesh = playerGroup;
            this.mesh = playerGroup; // Use temp mesh until model loads
            this.scene.add(this.mesh);

            log('Temporary player model created');
        } catch (err) {
            error('Error creating temporary mesh', err);

            // Create an absolute fallback - just a box
            const geometry = new THREE.BoxGeometry(1, 2, 1);
            const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
            this.mesh = new THREE.Mesh(geometry, material);
            this.mesh.position.set(this.position.x, this.position.y, this.position.z);
            this.scene.add(this.mesh);

            log('Fallback box mesh created');
        }
    }

    loadModel() {
        try {
            log('Loading blobville player model');

            const loader = new GLTFLoader();

            // Simplify to just one path that we know works from the logs
            const modelPath = '/public/models/blobville-player.glb';

            log(`Trying to load player model from: ${modelPath}`);

            loader.load(
                modelPath,
                (gltf) => {
                    log('Blobville player model loaded successfully!');
                    this.setupModel(gltf);
                },
                (xhr) => {
                    if (xhr.lengthComputable) {
                        const percent = (xhr.loaded / xhr.total * 100).toFixed(2);
                        log(`Loading model: ${percent}%`);
                    }
                },
                (err) => {
                    error(`Failed to load player model: ${err.message}`);
                    // Fall back to the temporary mesh
                    log('Using fallback temporary mesh for player');
                }
            );
        } catch (err) {
            error('Error in loadModel', err);
        }
    }

    // Separate method to set up the model once loaded
    setupModel(gltf) {
        try {
            // Set up the model
            const model = gltf.scene;

            // Keep the current position
            if (this.mesh) {
                model.position.copy(this.mesh.position);
            } else {
                model.position.set(this.position.x, this.position.y, this.position.z);
            }

            // FIX 1: Rotate the model 180 degrees to face forward instead of backward
            model.rotation.set(0, Math.PI, 0); // This should make it face forward

            // Make sure the model casts shadows
            model.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });

            // FIX 2: Scale down the model to make it smaller
            model.scale.set(0.35, 0.35, 0.35); // Reduced from 0.5 to 0.35 (70% of previous size)

            // Remove the temporary mesh
            if (this.tempMesh) {
                this.scene.remove(this.tempMesh);
            }

            // Replace the mesh
            if (this.mesh && this.mesh !== this.tempMesh) {
                this.scene.remove(this.mesh);
            }

            this.mesh = model;
            this.scene.add(this.mesh);
            this.modelLoaded = true;

            // Set up animations
            this.setupAnimations(gltf.animations);
        } catch (err) {
            error('Error setting up model', err);
        }
    }

    // Separate method to set up animations
    setupAnimations(animations) {
        if (!animations || animations.length === 0) {
            log('No animations found, creating fake animations');
            this.createFakeAnimations();
            return;
        }

        log(`Found ${animations.length} animations`);

        // Create animation mixer
        this.mixer = new THREE.AnimationMixer(this.mesh);

        // Log all animation names
        animations.forEach((clip, index) => {
            log(`Animation ${index}: ${clip.name}`);
        });

        // Map animations to our animation types
        animations.forEach(clip => {
            switch (clip.name) {
                case 'idle': this.animations.idle = clip; break;
                case 'walkForward': this.animations.walkForward = clip; break;
                case 'walkBackward': this.animations.walkBackward = clip; break;
                case 'strafeLeft': this.animations.strafeLeft = clip; break;
                case 'strafeRight': this.animations.strafeRight = clip; break;
                case 'jump': this.animations.jump = clip; break;
                case 'attack': this.animations.attack = clip; break;
            }
        });

        // If strafeLeft is missing, use strafeRight and reverse it
        if (!this.animations.strafeLeft && this.animations.strafeRight) {
            log('Creating strafeLeft from strafeRight');
            const strafeRightClip = this.animations.strafeRight;

            // Clone the strafeRight animation and reverse it
            const strafeLeftClip = THREE.AnimationClip.parse(THREE.AnimationClip.toJSON(strafeRightClip));
            strafeLeftClip.name = 'strafeLeft';

            // Reverse the animation by negating the values
            strafeLeftClip.tracks.forEach(track => {
                if (track.name.includes('position.x') || track.name.includes('quaternion')) {
                    for (let i = 0; i < track.values.length; i++) {
                        track.values[i] = -track.values[i];
                    }
                }
            });

            this.animations.strafeLeft = strafeLeftClip;
        }

        // Make attack animation smoother
        if (this.animations.attack) {
            const attackClip = this.animations.attack;
            // Slow down the attack animation a bit
            attackClip.duration *= 1.5;
        }

        // If we don't have all animations, use the first one as a fallback
        if (!this.animations.idle && animations.length > 0) {
            this.animations.idle = animations[0];
            log('Using first animation as idle');
        }

        // Start with idle animation
        if (this.animations.idle) {
            this.playAnimation('idle');
        }
    }

    createFakeAnimations() {
        log('Creating fake animations for blob model');

        // Create a simple up/down bobbing animation for idle
        const times = [0, 0.5, 1];
        const values = [0, 0.1, 0]; // Y position values

        // Create tracks for different animations
        const idleTrack = new THREE.KeyframeTrack(
            '.position[y]', // Property to animate
            times,
            [0, 0.1, 0] // Slight up and down movement
        );

        const walkTrack = new THREE.KeyframeTrack(
            '.position[y]',
            times,
            [0, 0.2, 0] // More pronounced movement
        );

        const runTrack = new THREE.KeyframeTrack(
            '.position[y]',
            times,
            [0, 0.3, 0] // Even more movement
        );

        const jumpTrack = new THREE.KeyframeTrack(
            '.position[y]',
            [0, 0.5, 1],
            [0, 0.5, 0] // Big jump
        );

        // Create animation clips
        this.animations.idle = new THREE.AnimationClip('idle', 1.5, [idleTrack]);
        this.animations.walkForward = new THREE.AnimationClip('walkForward', 1, [walkTrack]);
        this.animations.walkBackward = new THREE.AnimationClip('walkBackward', 1, [walkTrack]);
        this.animations.strafeLeft = new THREE.AnimationClip('strafeLeft', 1, [walkTrack]);
        this.animations.strafeRight = new THREE.AnimationClip('strafeRight', 1, [walkTrack]);
        this.animations.jump = new THREE.AnimationClip('jump', 0.8, [jumpTrack]);
        this.animations.attack = new THREE.AnimationClip('attack', 0.8, [jumpTrack]);

        // Create mixer if it doesn't exist
        if (!this.mixer && this.mesh) {
            this.mixer = new THREE.AnimationMixer(this.mesh);
        }

        // Start with idle animation
        if (this.mixer) {
            this.playAnimation('idle');
        }
    }

    createPhysics() {
        try {
            log('Creating player physics');

            // Create physics body for player with simplified properties
            const shape = new Ammo.btCapsuleShape(0.5, 1);
            const transform = new Ammo.btTransform();
            transform.setIdentity();
            transform.setOrigin(new Ammo.btVector3(
                this.position.x, this.position.y, this.position.z
            ));

            const mass = 1;
            const localInertia = new Ammo.btVector3(0, 0, 0);

            // Skip inertia calculation
            // shape.calculateLocalInertia(mass, localInertia);

            const motionState = new Ammo.btDefaultMotionState(transform);
            const rbInfo = new Ammo.btRigidBodyConstructionInfo(
                mass, motionState, shape, localInertia
            );

            this.body = new Ammo.btRigidBody(rbInfo);
            this.body.setFriction(0.5);
            this.body.setRestitution(0.2);

            // Prevent player from tipping over
            this.body.setAngularFactor(new Ammo.btVector3(0, 1, 0));

            this.physicsWorld.addRigidBody(this.body);

            log('Player physics created');
        } catch (err) {
            error('Error creating physics', err);
        }
    }

    playAnimation(name) {
        if (!this.mixer) {
            log('No mixer available for animations');
            return;
        }

        if (!this.animations[name]) {
            log(`Animation ${name} not found, falling back to idle`);
            // Try to fall back to idle
            if (name !== 'idle' && this.animations.idle) {
                this.playAnimation('idle');
            }
            return;
        }

        // Don't restart the same animation
        if (this.currentAnimation === name) return;

        log(`Playing animation: ${name}`);

        // For attack and jump animations, we want to make sure they complete
        const isOneShot = (name === 'attack' || name === 'jump');

        // Stop any current animation with appropriate crossfade
        if (this.currentAction) {
            const fadeTime = isOneShot ? 0.1 : 0.2; // Faster transition for one-shot animations
            this.currentAction.fadeOut(fadeTime);
        }

        // Start new animation
        const action = this.mixer.clipAction(this.animations[name]);
        action.reset();

        const fadeInTime = isOneShot ? 0.1 : 0.2; // Faster transition for one-shot animations
        action.fadeIn(fadeInTime);

        // For attack and jump animations, set them to play once and then return to idle
        if (isOneShot) {
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true; // Keep the last frame when finished
        }

        action.play();
        this.currentAction = action;
        this.currentAnimation = name;
    }

    updateMovementAnimation(input) {
        if (this.isAttacking) return; // Don't interrupt attack animation

        if (input.jump && this.canJump) {
            this.playAnimation('jump');
        } else if (input.forward) {
            this.playAnimation('walkForward');
        } else if (input.backward) {
            this.playAnimation('walkBackward');
        } else if (input.left) {
            this.playAnimation('strafeLeft');
        } else if (input.right) {
            this.playAnimation('strafeRight');
        } else {
            this.playAnimation('idle');
        }
    }

    attack() {
        if (this.isAttacking) return;

        this.isAttacking = true;
        this.playAnimation('attack');

        // Reset attack state after a fixed time
        setTimeout(() => {
            this.isAttacking = false;

            // If we're still in attack animation, switch back to idle
            if (this.currentAnimation === 'attack') {
                this.playAnimation('idle');
            }
        }, 800); // Fixed time for attack animation
    }

    jump() {
        if (this.isJumping) return;

        this.isJumping = true;
        this.playAnimation('jump');

        // Get the duration of the jump animation
        let jumpDuration = 1000; // Default duration if we can't determine it
        if (this.animations.jump) {
            // Get actual duration from the animation clip
            jumpDuration = this.animations.jump.duration * 1000; // Convert to milliseconds

            // Add a small buffer to ensure animation completes
            jumpDuration += 200;
        }

        // Reset jump state after animation completes
        setTimeout(() => {
            this.isJumping = false;
            log('Jump state reset');
        }, jumpDuration);
    }

    update(deltaTime) {
        try {
            if (!this.body || !this.mesh) return;

            // Update mesh position based on physics
            const ms = this.body.getMotionState();
            if (ms) {
                const transform = new Ammo.btTransform();
                ms.getWorldTransform(transform);
                const p = transform.getOrigin();

                // Update position
                this.mesh.position.set(p.x(), p.y() - 1.0, p.z());

                // Make sure the player doesn't fall through the world
                if (p.y() < -10) {
                    // Reset position if player falls too far
                    const resetTransform = new Ammo.btTransform();
                    resetTransform.setIdentity();
                    resetTransform.setOrigin(new Ammo.btVector3(0, 5, 0));
                    ms.setWorldTransform(resetTransform);
                    this.body.setWorldTransform(resetTransform);

                    // Reset velocity
                    const zero = new Ammo.btVector3(0, 0, 0);
                    this.body.setLinearVelocity(zero);
                    this.body.setAngularVelocity(zero);
                }

                // Make the player always face the direction of the crosshair/camera
                if (this.modelLoaded && window.game && window.game.scene) {
                    const cameraDirection = new THREE.Vector3();
                    window.game.scene.camera.getWorldDirection(cameraDirection);
                    cameraDirection.y = 0; // Keep upright
                    cameraDirection.normalize();

                    // Calculate the angle to face the camera direction
                    const angle = Math.atan2(cameraDirection.x, cameraDirection.z);

                    // Set rotation to match crosshair direction
                    this.mesh.rotation.set(0, angle, 0);
                }
            }

            // Update animation mixer
            if (this.mixer && deltaTime) {
                this.mixer.update(deltaTime);
            }
        } catch (err) {
            error('Error in player update', err);
        }
    }

    applyForce(force) {
        try {
            if (!this.body) return;
            this.body.activate(true);
            this.body.applyCentralImpulse(force);
        } catch (err) {
            error('Error applying force', err);
        }
    }

    getPosition() {
        if (!this.mesh) return new THREE.Vector3();
        return this.mesh.position;
    }

    shoot() {
        // Get the direction the player is facing
        const direction = this.getAimDirection();

        // Create a projectile in that direction
        // ... existing projectile creation code ...
    }

    getAimDirection() {
        // Get the camera direction for aiming
        const direction = new THREE.Vector3();
        // We need to access the camera from the scene
        // This assumes the scene has a reference to the camera
        if (window.game && window.game.scene && window.game.scene.camera) {
            window.game.scene.camera.getWorldDirection(direction);
        }
        return direction;
    }

    setRotation(yRotation) {
        if (this.mesh) {
            // For the model, we only want to set the Y rotation
            if (this.modelLoaded) {
                // Add a small delay to make the rotation smoother
                const currentRotation = this.mesh.rotation.y;
                const rotationDiff = yRotation - currentRotation;

                // Normalize the difference to be between -PI and PI
                let normalizedDiff = rotationDiff;
                while (normalizedDiff > Math.PI) normalizedDiff -= Math.PI * 2;
                while (normalizedDiff < -Math.PI) normalizedDiff += Math.PI * 2;

                // Apply a smooth rotation (interpolate)
                this.mesh.rotation.y += normalizedDiff * 0.1; // 10% of the way there
            } else {
                // For the temp mesh, we can set the full rotation
                const currentRotation = new THREE.Euler().setFromQuaternion(this.mesh.quaternion);
                this.mesh.rotation.set(currentRotation.x, yRotation, currentRotation.z);
            }
        }
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);

        // Update health UI
        this.updateHealthUI();

        if (this.health <= 0 && !this.isDead) {
            this.die();
        }
    }

    updateHealthUI() {
        const healthBar = document.getElementById('health-bar');
        const healthText = document.getElementById('health-text');

        if (healthBar && healthText) {
            // Update health bar width
            healthBar.style.width = `${this.health}%`;

            // Update health text
            healthText.textContent = `${this.health} HP`;

            // Change color based on health
            if (this.health > 70) {
                healthBar.style.backgroundColor = 'rgba(0, 255, 0, 0.7)'; // Green
            } else if (this.health > 30) {
                healthBar.style.backgroundColor = 'rgba(255, 255, 0, 0.7)'; // Yellow
            } else {
                healthBar.style.backgroundColor = 'rgba(255, 0, 0, 0.7)'; // Red
            }
        }
    }

    die() {
        this.isDead = true;

        // Show death message
        const deathMessage = document.createElement('div');
        deathMessage.style.position = 'fixed';
        deathMessage.style.top = '50%';
        deathMessage.style.left = '50%';
        deathMessage.style.transform = 'translate(-50%, -50%)';
        deathMessage.style.color = 'red';
        deathMessage.style.fontSize = '48px';
        deathMessage.style.fontFamily = 'Arial, sans-serif';
        deathMessage.style.fontWeight = 'bold';
        deathMessage.style.textShadow = '2px 2px 4px black';
        deathMessage.textContent = 'YOU DIED';

        document.body.appendChild(deathMessage);

        // Respawn after 3 seconds
        setTimeout(() => {
            this.respawn();
            document.body.removeChild(deathMessage);
        }, 3000);
    }

    respawn() {
        // Reset health
        this.health = 100;
        this.isDead = false;
        this.updateHealthUI();

        // Reset position
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(0, 5, 0));

        const ms = this.body.getMotionState();
        ms.setWorldTransform(transform);

        this.body.setWorldTransform(transform);

        // Reset velocity
        const zero = new Ammo.btVector3(0, 0, 0);
        this.body.setLinearVelocity(zero);
        this.body.setAngularVelocity(zero);

        // Activate the body
        this.body.activate(true);
    }

    setAnimation(name) {
        this.playAnimation(name);
    }
}
