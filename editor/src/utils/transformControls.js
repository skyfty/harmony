import {
	BoxGeometry,
	BufferGeometry,
	Controls,
	CylinderGeometry,
	DoubleSide,
	Euler,
	Float32BufferAttribute,
	Line,
	LineBasicMaterial,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	OctahedronGeometry,
	PlaneGeometry,
	Quaternion,
	Raycaster,
	SphereGeometry,
	TorusGeometry,
	Vector3
} from 'three';

const _raycaster = new Raycaster();

const _tempVector = new Vector3();
const _tempVector2 = new Vector3();
const _tempQuaternion = new Quaternion();
const _unit = {
	X: new Vector3( 1, 0, 0 ),
	Y: new Vector3( 0, 1, 0 ),
	Z: new Vector3( 0, 0, 1 )
};

/**
 * Fires if any type of change (object or property change) is performed. Property changes
 * are separate events you can add event listeners to. The event type is "propertyname-changed".
 *
 * @event TransformControls#change
 * @type {Object}
 */
const _changeEvent = { type: 'change' };

/**
 * Fires if a pointer (mouse/touch) becomes active.
 *
 * @event TransformControls#mouseDown
 * @type {Object}
 */
const _mouseDownEvent = { type: 'mouseDown', mode: null };

/**
 * Fires if a pointer (mouse/touch) is no longer active.
 *
 * @event TransformControls#mouseUp
 * @type {Object}
 */
const _mouseUpEvent = { type: 'mouseUp', mode: null };

/**
 * Fires if the controlled 3D object is changed.
 *
 * @event TransformControls#objectChange
 * @type {Object}
 */
const _objectChangeEvent = { type: 'objectChange' };

/**
 * This class can be used to transform objects in 3D space by adapting a similar interaction model
 * of DCC tools like Blender. Unlike other controls, it is not intended to transform the scene's camera.
 *
 * `TransformControls` expects that its attached 3D object is part of the scene graph.
 *
 * @augments Controls
 * @three_import import { TransformControls } from 'three/addons/controls/TransformControls.js';
 */
class TransformControls extends Controls {

	/**
	 * Constructs a new controls instance.
	 *
	 * @param {Camera} camera - The camera of the rendered scene.
	 * @param {?HTMLDOMElement} domElement - The HTML element used for event listeners.
	 */
	constructor( camera, domElement = null ) {

		super( undefined, domElement );

		const root = new TransformControlsRoot( this );
		this._root = root;

		const gizmo = new TransformControlsGizmo();
		this._gizmo = gizmo;
		root.add( gizmo );

		const plane = new TransformControlsPlane();
		this._plane = plane;
		root.add( plane );

		// Combined 'transform' mode state: `transformFamilies` selects which handle
		// families are rendered and `interactionMode` tracks the family the pointer
		// is currently interacting with (used by the drag math).
		this.interactionMode = 'translate';
		this.transformFamilies = [ 'translate', 'rotate', 'scale' ];
		gizmo.interactionMode = this.interactionMode;
		gizmo.transformFamilies = this.transformFamilies;
		plane.interactionMode = this.interactionMode;
		plane.transformFamilies = this.transformFamilies;

		const scope = this;

		// Defined getter, setter and store for a property
		function defineProperty( propName, defaultValue ) {

			let propValue = defaultValue;

			Object.defineProperty( scope, propName, {

				get: function () {

					return propValue !== undefined ? propValue : defaultValue;

				},

				set: function ( value ) {

					if ( propValue !== value ) {

						propValue = value;
						plane[ propName ] = value;
						gizmo[ propName ] = value;

						scope.dispatchEvent( { type: propName + '-changed', value: value } );
						scope.dispatchEvent( _changeEvent );

					}

				}

			} );

			scope[ propName ] = defaultValue;
			plane[ propName ] = defaultValue;
			gizmo[ propName ] = defaultValue;

		}

		// Define properties with getters/setter
		// Setting the defined property will automatically trigger change event
		// Defined properties are passed down to gizmo and plane

		/**
		 * The camera of the rendered scene.
		 *
		 * @name TransformControls#camera
		 * @type {Camera}
		 */
		defineProperty( 'camera', camera );
		defineProperty( 'object', undefined );
		defineProperty( 'enabled', true );

		/**
		 * The current transformation axis.
		 *
		 * @name TransformControls#axis
		 * @type {string}
		 */
		defineProperty( 'axis', null );

		/**
		 * The current transformation axis.
		 *
		 * @name TransformControls#mode
		 * @type {('translate'|'rotate'|'scale')}
		 * @default 'translate'
		 */
		defineProperty( 'mode', 'translate' );

		/**
		 * By default, 3D objects are continuously translated. If you set this property to a numeric
		 * value (world units), you can define in which steps the 3D object should be translated.
		 *
		 * @name TransformControls#translationSnap
		 * @type {?number}
		 * @default null
		 */
		defineProperty( 'translationSnap', null );

		/**
		 * By default, 3D objects are continuously rotated. If you set this property to a numeric
		 * value (radians), you can define in which steps the 3D object should be rotated.
		 *
		 * @name TransformControls#rotationSnap
		 * @type {?number}
		 * @default null
		 */
		defineProperty( 'rotationSnap', null );

		/**
		 * By default, 3D objects are continuously scaled. If you set this property to a numeric
		 * value, you can define in which steps the 3D object should be scaled.
		 *
		 * @name TransformControls#scaleSnap
		 * @type {?number}
		 * @default null
		 */
		defineProperty( 'scaleSnap', null );

		/**
		 * Defines in which coordinate space transformations should be performed.
		 *
		 * @name TransformControls#space
		 * @type {('world'|'local')}
		 * @default 'world'
		 */
		defineProperty( 'space', 'world' );

		/**
		 * The size of the helper UI (axes/planes).
		 *
		 * @name TransformControls#size
		 * @type {number}
		 * @default 1
		 */
		defineProperty( 'size', 1 );

		/**
		 * Whether dragging is currently performed or not.
		 *
		 * @name TransformControls#dragging
		 * @type {boolean}
		 * @readonly
		 * @default false
		 */
		defineProperty( 'dragging', false );

		/**
		 * Whether the x-axis helper should be visible or not.
		 *
		 * @name TransformControls#showX
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showX', true );

		/**
		 * Whether the y-axis helper should be visible or not.
		 *
		 * @name TransformControls#showY
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showY', true );

		/**
		 * Whether the z-axis helper should be visible or not.
		 *
		 * @name TransformControls#showZ
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showZ', true );

		/**
		 * The minimum allowed X position during translation.
		 *
		 * @name TransformControls#minX
		 * @type {number}
		 * @default -Infinity
		 */
		defineProperty( 'minX', - Infinity );

		/**
		 * The maximum allowed X position during translation.
		 *
		 * @name TransformControls#maxX
		 * @type {number}
		 * @default Infinity
		 */
		defineProperty( 'maxX', Infinity );

		/**
		 * The minimum allowed y position during translation.
		 *
		 * @name TransformControls#minY
		 * @type {number}
		 * @default -Infinity
		 */
		defineProperty( 'minY', - Infinity );

		/**
		 * The maximum allowed Y position during translation.
		 *
		 * @name TransformControls#maxY
		 * @type {number}
		 * @default Infinity
		 */
		defineProperty( 'maxY', Infinity );

		/**
		 * The minimum allowed z position during translation.
		 *
		 * @name TransformControls#minZ
		 * @type {number}
		 * @default -Infinity
		 */
		defineProperty( 'minZ', - Infinity );

		/**
		 * The maximum allowed Z position during translation.
		 *
		 * @name TransformControls#maxZ
		 * @type {number}
		 * @default Infinity
		 */
		defineProperty( 'maxZ', Infinity );

		// Reusable utility variables

		const worldPosition = new Vector3();
		const worldPositionStart = new Vector3();
		const worldQuaternion = new Quaternion();
		const worldQuaternionStart = new Quaternion();
		const cameraPosition = new Vector3();
		const cameraQuaternion = new Quaternion();
		const pointStart = new Vector3();
		const pointEnd = new Vector3();
		const rotationAxis = new Vector3();
		const rotationAngle = 0;
		const eye = new Vector3();

		// TODO: remove properties unused in plane and gizmo

		defineProperty( 'worldPosition', worldPosition );
		defineProperty( 'worldPositionStart', worldPositionStart );
		defineProperty( 'worldQuaternion', worldQuaternion );
		defineProperty( 'worldQuaternionStart', worldQuaternionStart );
		defineProperty( 'cameraPosition', cameraPosition );
		defineProperty( 'cameraQuaternion', cameraQuaternion );
		defineProperty( 'pointStart', pointStart );
		defineProperty( 'pointEnd', pointEnd );
		defineProperty( 'rotationAxis', rotationAxis );
		defineProperty( 'rotationAngle', rotationAngle );
		defineProperty( 'eye', eye );

		this._offset = new Vector3();
		this._startNorm = new Vector3();
		this._endNorm = new Vector3();
		this._cameraScale = new Vector3();

		this._parentPosition = new Vector3();
		this._parentQuaternion = new Quaternion();
		this._parentQuaternionInv = new Quaternion();
		this._parentScale = new Vector3();

		this._worldScaleStart = new Vector3();
		this._worldQuaternionInv = new Quaternion();
		this._worldScale = new Vector3();

		this._positionStart = new Vector3();
		this._quaternionStart = new Quaternion();
		this._scaleStart = new Vector3();

		this._getPointer = getPointer.bind( this );
		this._onPointerDown = onPointerDown.bind( this );
		this._onPointerHover = onPointerHover.bind( this );
		this._onPointerMove = onPointerMove.bind( this );
		this._onPointerUp = onPointerUp.bind( this );

		if ( domElement !== null ) {

			this.connect( domElement );

		}

	}

	connect( element ) {

		super.connect( element );

		this.domElement.addEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.addEventListener( 'pointermove', this._onPointerHover );
		this.domElement.addEventListener( 'pointerup', this._onPointerUp );

		this.domElement.style.touchAction = 'none'; // disable touch scroll

	}

	disconnect() {

		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.removeEventListener( 'pointermove', this._onPointerHover );
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.removeEventListener( 'pointerup', this._onPointerUp );

		this.domElement.style.touchAction = 'auto';

	}

	/**
	 * Returns the visual representation of the controls. Add the helper to your scene to
	 * visually transform the attached  3D object.
	 *
	 * @return {TransformControlsRoot} The helper.
	 */
	getHelper() {

		return this._root;

	}

	pointerHover( pointer ) {

		if ( this.object === undefined || this.dragging === true ) return;

		if ( pointer !== null ) _raycaster.setFromCamera( pointer, this.camera );

		const intersect = this._intersectActiveHandles( _raycaster );

		if ( intersect ) {

			this.setInteractionMode( intersect.family );
			this.axis = intersect.object.name;

		} else {

			this.setInteractionMode( this.getFallbackInteractionMode() );
			this.axis = null;

		}

	}

	/**
	 * Returns the nearest visible handle of the active picker(s). For the combined
	 * 'transform' mode the hit handle also reports its family so the drag can reuse
	 * the matching translate/rotate/scale math.
	 */
	_intersectActiveHandles( raycaster ) {

		if ( this.mode === 'transform' ) {

			const intersections = raycaster.intersectObject( this._gizmo.picker[ 'transform' ], true );

			for ( let i = 0; i < intersections.length; i ++ ) {

				const object = intersections[ i ].object;

				if ( object.visible === false ) continue;
				if ( this.transformFamilies.indexOf( object.family ) === - 1 ) continue;

				return { object: object, family: object.family };

			}

			return null;

		}

		const intersections = raycaster.intersectObject( this._gizmo.picker[ this.mode ], true );

		for ( let i = 0; i < intersections.length; i ++ ) {

			if ( intersections[ i ].object.visible ) {

				return { object: intersections[ i ].object, family: this.mode };

			}

		}

		return null;

	}

	getFallbackInteractionMode() {

		if ( this.mode === 'transform' ) {

			return this.transformFamilies.length > 0 ? this.transformFamilies[ 0 ] : 'translate';

		}

		return this.mode;

	}

	/**
	 * Updates the family used by the drag math without notifying listeners.
	 */
	setInteractionMode( family ) {

		const next = ( family === 'translate' || family === 'rotate' || family === 'scale' )
			? family
			: this.getFallbackInteractionMode();

		if ( this.interactionMode === next ) return;

		this.interactionMode = next;
		this._gizmo.interactionMode = next;
		this._plane.interactionMode = next;

	}

	pointerDown( pointer ) {

		if ( this.object === undefined || this.dragging === true || ( pointer != null && pointer.button !== 0 ) ) return;

		if ( this.axis !== null ) {

			if ( pointer !== null ) _raycaster.setFromCamera( pointer, this.camera );

			const planeIntersect = intersectObjectWithRay( this._plane, _raycaster, true );

			if ( planeIntersect ) {

				this.object.updateMatrixWorld();
				this.object.parent.updateMatrixWorld();

				this._positionStart.copy( this.object.position );
				this._quaternionStart.copy( this.object.quaternion );
				this._scaleStart.copy( this.object.scale );

				this.object.matrixWorld.decompose( this.worldPositionStart, this.worldQuaternionStart, this._worldScaleStart );

				const pivotOverride = this.object.userData && this.object.userData.transformControlsPivotWorld;
				if ( pivotOverride && pivotOverride.isVector3 ) {
					this.worldPositionStart.copy( pivotOverride );
				}

				this.pointStart.copy( planeIntersect.point ).sub( this.worldPositionStart );

			}

			this.dragging = true;
			_mouseDownEvent.mode = this.getInteractionMode();
			this.dispatchEvent( _mouseDownEvent );

		}

	}

	pointerMove( pointer ) {

		const axis = this.axis;
		const mode = this.getInteractionMode();
		const object = this.object;
		let space = this.space;

		if ( mode === 'scale' ) {

			space = 'local';

		} else if ( axis === 'E' || axis === 'XYZE' || axis === 'XYZ' ) {

			space = 'world';

		}

		if ( object === undefined || axis === null || this.dragging === false || ( pointer !== null && pointer.button !== - 1 ) ) return;

		if ( pointer !== null ) _raycaster.setFromCamera( pointer, this.camera );

		const planeIntersect = intersectObjectWithRay( this._plane, _raycaster, true );

		if ( ! planeIntersect ) return;

		this.pointEnd.copy( planeIntersect.point ).sub( this.worldPositionStart );

		if ( mode === 'translate' ) {

			// Apply translate

			this._offset.copy( this.pointEnd ).sub( this.pointStart );

			if ( space === 'local' && axis !== 'XYZ' ) {

				this._offset.applyQuaternion( this._worldQuaternionInv );

			}

			if ( axis.indexOf( 'X' ) === - 1 ) this._offset.x = 0;
			if ( axis.indexOf( 'Y' ) === - 1 ) this._offset.y = 0;
			if ( axis.indexOf( 'Z' ) === - 1 ) this._offset.z = 0;

			if ( space === 'local' && axis !== 'XYZ' ) {

				this._offset.applyQuaternion( this._quaternionStart ).divide( this._parentScale );

			} else {

				this._offset.applyQuaternion( this._parentQuaternionInv ).divide( this._parentScale );

			}

			object.position.copy( this._offset ).add( this._positionStart );

			// Apply translation snap

			if ( this.translationSnap ) {

				if ( space === 'local' ) {

					object.position.applyQuaternion( _tempQuaternion.copy( this._quaternionStart ).invert() );

					if ( axis.search( 'X' ) !== - 1 ) {

						object.position.x = Math.round( object.position.x / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Y' ) !== - 1 ) {

						object.position.y = Math.round( object.position.y / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Z' ) !== - 1 ) {

						object.position.z = Math.round( object.position.z / this.translationSnap ) * this.translationSnap;

					}

					object.position.applyQuaternion( this._quaternionStart );

				}

				if ( space === 'world' ) {

					if ( object.parent ) {

						object.position.add( _tempVector.setFromMatrixPosition( object.parent.matrixWorld ) );

					}

					if ( axis.search( 'X' ) !== - 1 ) {

						object.position.x = Math.round( object.position.x / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Y' ) !== - 1 ) {

						object.position.y = Math.round( object.position.y / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Z' ) !== - 1 ) {

						object.position.z = Math.round( object.position.z / this.translationSnap ) * this.translationSnap;

					}

					if ( object.parent ) {

						object.position.sub( _tempVector.setFromMatrixPosition( object.parent.matrixWorld ) );

					}

				}

			}

			object.position.x = Math.max( this.minX, Math.min( this.maxX, object.position.x ) );
			object.position.y = Math.max( this.minY, Math.min( this.maxY, object.position.y ) );
			object.position.z = Math.max( this.minZ, Math.min( this.maxZ, object.position.z ) );

		} else if ( mode === 'scale' ) {

			if ( axis.search( 'XYZ' ) !== - 1 ) {

				let d = this.pointEnd.length() / this.pointStart.length();

				if ( this.pointEnd.dot( this.pointStart ) < 0 ) d *= - 1;

				_tempVector2.set( d, d, d );

			} else {

				_tempVector.copy( this.pointStart );
				_tempVector2.copy( this.pointEnd );

				_tempVector.applyQuaternion( this._worldQuaternionInv );
				_tempVector2.applyQuaternion( this._worldQuaternionInv );

				_tempVector2.divide( _tempVector );

				if ( axis.search( 'X' ) === - 1 ) {

					_tempVector2.x = 1;

				}

				if ( axis.search( 'Y' ) === - 1 ) {

					_tempVector2.y = 1;

				}

				if ( axis.search( 'Z' ) === - 1 ) {

					_tempVector2.z = 1;

				}

			}

			// Apply scale

			object.scale.copy( this._scaleStart ).multiply( _tempVector2 );

			if ( this.scaleSnap ) {

				if ( axis.search( 'X' ) !== - 1 ) {

					object.scale.x = Math.round( object.scale.x / this.scaleSnap ) * this.scaleSnap || this.scaleSnap;

				}

				if ( axis.search( 'Y' ) !== - 1 ) {

					object.scale.y = Math.round( object.scale.y / this.scaleSnap ) * this.scaleSnap || this.scaleSnap;

				}

				if ( axis.search( 'Z' ) !== - 1 ) {

					object.scale.z = Math.round( object.scale.z / this.scaleSnap ) * this.scaleSnap || this.scaleSnap;

				}

			}

		} else if ( mode === 'rotate' ) {

			this._offset.copy( this.pointEnd ).sub( this.pointStart );

			const ROTATION_SPEED = 20 / this.worldPosition.distanceTo( _tempVector.setFromMatrixPosition( this.camera.matrixWorld ) );

			let _inPlaneRotation = false;

			if ( axis === 'XYZE' ) {

				this.rotationAxis.copy( this._offset ).cross( this.eye ).normalize();
				this.rotationAngle = this._offset.dot( _tempVector.copy( this.rotationAxis ).cross( this.eye ) ) * ROTATION_SPEED;

			} else if ( axis === 'X' || axis === 'Y' || axis === 'Z' ) {

				this.rotationAxis.copy( _unit[ axis ] );

				_tempVector.copy( _unit[ axis ] );

				if ( space === 'local' ) {

					_tempVector.applyQuaternion( this.worldQuaternion );

				}

				_tempVector.cross( this.eye );

				// When _tempVector is 0 after cross with this.eye the vectors are parallel and should use in-plane rotation logic.
				if ( _tempVector.length() === 0 ) {

					_inPlaneRotation = true;

				} else {

					this.rotationAngle = this._offset.dot( _tempVector.normalize() ) * ROTATION_SPEED;

				}


			}

			if ( axis === 'E' || _inPlaneRotation ) {

				this.rotationAxis.copy( this.eye );
				this.rotationAngle = this.pointEnd.angleTo( this.pointStart );

				this._startNorm.copy( this.pointStart ).normalize();
				this._endNorm.copy( this.pointEnd ).normalize();

				this.rotationAngle *= ( this._endNorm.cross( this._startNorm ).dot( this.eye ) < 0 ? 1 : - 1 );

			}

			// Apply rotation snap

			if ( this.rotationSnap ) this.rotationAngle = Math.round( this.rotationAngle / this.rotationSnap ) * this.rotationSnap;

			// Apply rotate
			if ( space === 'local' && axis !== 'E' && axis !== 'XYZE' ) {

				object.quaternion.copy( this._quaternionStart );
				object.quaternion.multiply( _tempQuaternion.setFromAxisAngle( this.rotationAxis, this.rotationAngle ) ).normalize();

			} else {

				this.rotationAxis.applyQuaternion( this._parentQuaternionInv );
				object.quaternion.copy( _tempQuaternion.setFromAxisAngle( this.rotationAxis, this.rotationAngle ) );
				object.quaternion.multiply( this._quaternionStart ).normalize();

			}

		}

		this.dispatchEvent( _changeEvent );
		this.dispatchEvent( _objectChangeEvent );

	}

	pointerUp( pointer ) {

		if ( pointer !== null && pointer.button !== 0 ) return;

		if ( this.dragging && ( this.axis !== null ) ) {

			_mouseUpEvent.mode = this.getInteractionMode();
			this.dispatchEvent( _mouseUpEvent );

		}

		this.dragging = false;
		this.axis = null;

	}

	dispose() {

		this.disconnect();

		this._root.dispose();

	}

	/**
	 * Sets the 3D object that should be transformed and ensures the controls UI is visible.
	 *
	 * @param {Object3D} object -  The 3D object that should be transformed.
	 * @return {TransformControls} A reference to this controls.
	 */
	attach( object ) {

		this.object = object;
		this._root.visible = true;

		return this;

	}

	/**
	 * Removes the current 3D object from the controls and makes the helper UI invisible.
	 *
	 * @return {TransformControls} A reference to this controls.
	 */
	detach() {

		this.object = undefined;
		this.axis = null;

		this._root.visible = false;

		return this;

	}

	/**
	 * Resets the object's position, rotation and scale to when the current transform began.
	 */
	reset() {

		if ( ! this.enabled ) return;

		if ( this.dragging ) {

			this.object.position.copy( this._positionStart );
			this.object.quaternion.copy( this._quaternionStart );
			this.object.scale.copy( this._scaleStart );

			this.dispatchEvent( _changeEvent );
			this.dispatchEvent( _objectChangeEvent );

			this.pointStart.copy( this.pointEnd );

		}

	}

	/**
	 * Returns the raycaster that is used for user interaction. This object is shared between all
	 * instances of `TransformControls`.
	 *
	 * @returns {Raycaster} The internal raycaster.
	 */
	getRaycaster() {

		return _raycaster;

	}

	/**
	 * Returns the transformation mode.
	 *
	 * @returns {'translate'|'rotate'|'scale'|'transform'} The transformation mode.
	 */
	getMode() {

		return this.mode;

	}

	/**
	 * Sets the given transformation mode.
	 *
	 * @param {'translate'|'rotate'|'scale'|'transform'} mode - The transformation mode to set.
	 */
	setMode( mode ) {

		this.mode = mode;

		if ( mode === 'transform' ) {

			this.setInteractionMode( this.getFallbackInteractionMode() );

		}

	}

	/**
	 * Returns the handle family that should drive the drag math. For the combined
	 * 'transform' mode this is the family of the handle being dragged, otherwise the
	 * plain transformation mode.
	 *
	 * @returns {'translate'|'rotate'|'scale'} The interaction family.
	 */
	getInteractionMode() {

		if ( this.mode === 'transform' ) {

			if ( this.interactionMode === 'translate'
				|| this.interactionMode === 'rotate'
				|| this.interactionMode === 'scale' ) {

				return this.interactionMode;

			}

			return this.getFallbackInteractionMode();

		}

		return this.mode;

	}

	/**
	 * Restricts which handle families the combined 'transform' mode renders.
	 * Useful for selections that only support a subset (e.g. move only).
	 *
	 * @param {('translate'|'rotate'|'scale')[]} families - The families to render.
	 */
	setTransformFamilies( families ) {

		const next = [];
		const order = [ 'translate', 'rotate', 'scale' ];

		if ( Array.isArray( families ) ) {

			for ( let i = 0; i < order.length; i ++ ) {

				if ( families.indexOf( order[ i ] ) !== - 1 ) next.push( order[ i ] );

			}

		}

		if ( next.length === 0 ) next.push( 'translate', 'rotate', 'scale' );

		this.transformFamilies = next;
		this._gizmo.transformFamilies = next;
		this._plane.transformFamilies = next;

		const current = this.interactionMode;
		if ( next.indexOf( current ) === - 1 ) {

			this.interactionMode = next[ 0 ];
			this._gizmo.interactionMode = next[ 0 ];
			this._plane.interactionMode = next[ 0 ];

		}

	}

	/**
	 * Sets the translation snap.
	 *
	 * @param {?number} translationSnap - The translation snap to set.
	 */
	setTranslationSnap( translationSnap ) {

		this.translationSnap = translationSnap;

	}

	/**
	 * Sets the rotation snap.
	 *
	 * @param {?number} rotationSnap - The rotation snap to set.
	 */
	setRotationSnap( rotationSnap ) {

		this.rotationSnap = rotationSnap;

	}

	/**
	 * Sets the scale snap.
	 *
	 * @param {?number} scaleSnap - The scale snap to set.
	 */
	setScaleSnap( scaleSnap ) {

		this.scaleSnap = scaleSnap;

	}

	/**
	 * Sets the size of the helper UI.
	 *
	 * @param {number} size - The size to set.
	 */
	setSize( size ) {

		this.size = size;

	}

	/**
	 * Sets the coordinate space in which transformations are applied.
	 *
	 * @param {'world'|'local'} space - The space to set.
	 */
	setSpace( space ) {

		this.space = space;

	}

	/**
	 * Sets the colors of the control's gizmo.
	 *
	 * @param {number|Color|string} xAxis - The x-axis color.
	 * @param {number|Color|string} yAxis - The y-axis color.
	 * @param {number|Color|string} zAxis - The z-axis color.
	 * @param {number|Color|string} active - The color for active elements.
	 */
	setColors( xAxis, yAxis, zAxis, active ) {

		const materialLib = this._gizmo.materialLib;

		materialLib.xAxis.color.set( xAxis );
		materialLib.yAxis.color.set( yAxis );
		materialLib.zAxis.color.set( zAxis );
		materialLib.active.color.set( active );
		materialLib.xAxisTransparent.color.set( xAxis );
		materialLib.yAxisTransparent.color.set( yAxis );
		materialLib.zAxisTransparent.color.set( zAxis );
		materialLib.activeTransparent.color.set( active );

		// update color caches

		if ( materialLib.xAxis._color ) materialLib.xAxis._color.set( xAxis );
		if ( materialLib.yAxis._color ) materialLib.yAxis._color.set( yAxis );
		if ( materialLib.zAxis._color ) materialLib.zAxis._color.set( zAxis );
		if ( materialLib.active._color ) materialLib.active._color.set( active );
		if ( materialLib.xAxisTransparent._color ) materialLib.xAxisTransparent._color.set( xAxis );
		if ( materialLib.yAxisTransparent._color ) materialLib.yAxisTransparent._color.set( yAxis );
		if ( materialLib.zAxisTransparent._color ) materialLib.zAxisTransparent._color.set( zAxis );
		if ( materialLib.activeTransparent._color ) materialLib.activeTransparent._color.set( active );

	}

}

// mouse / touch event handlers

function getPointer( event ) {

	if ( this.domElement.ownerDocument.pointerLockElement ) {

		return {
			x: 0,
			y: 0,
			button: event.button
		};

	} else {

		const rect = this.domElement.getBoundingClientRect();

		return {
			x: ( event.clientX - rect.left ) / rect.width * 2 - 1,
			y: - ( event.clientY - rect.top ) / rect.height * 2 + 1,
			button: event.button
		};

	}

}

function onPointerHover( event ) {

	if ( ! this.enabled ) return;

	switch ( event.pointerType ) {

		case 'mouse':
		case 'pen':
			this.pointerHover( this._getPointer( event ) );
			break;

	}

}

function onPointerDown( event ) {

	if ( ! this.enabled ) return;

	if ( ! document.pointerLockElement ) {

		this.domElement.setPointerCapture( event.pointerId );

	}

	this.domElement.addEventListener( 'pointermove', this._onPointerMove );

	this.pointerHover( this._getPointer( event ) );
	this.pointerDown( this._getPointer( event ) );

}

function onPointerMove( event ) {

	if ( ! this.enabled ) return;

	this.pointerMove( this._getPointer( event ) );

}

function onPointerUp( event ) {

	if ( ! this.enabled ) return;

	this.domElement.releasePointerCapture( event.pointerId );

	this.domElement.removeEventListener( 'pointermove', this._onPointerMove );

	this.pointerUp( this._getPointer( event ) );

}

function intersectObjectWithRay( object, raycaster, includeInvisible ) {

	const allIntersections = raycaster.intersectObject( object, true );

	for ( let i = 0; i < allIntersections.length; i ++ ) {

		if ( allIntersections[ i ].object.visible || includeInvisible ) {

			return allIntersections[ i ];

		}

	}

	return false;

}

//

// Reusable utility variables

const _tempEuler = new Euler();
const _alignVector = new Vector3( 0, 1, 0 );
const _zeroVector = new Vector3( 0, 0, 0 );
const _lookAtMatrix = new Matrix4();
const _tempQuaternion2 = new Quaternion();
const _identityQuaternion = new Quaternion();
const _dirVector = new Vector3();
const _tempMatrix = new Matrix4();

const _unitX = new Vector3( 1, 0, 0 );
const _unitY = new Vector3( 0, 1, 0 );
const _unitZ = new Vector3( 0, 0, 1 );

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();

/**
 * Combined 'transform' mode layout (Unity style Transform tool).
 *
 * Radii are authored directly into the handle geometry (gizmo units, before the
 * per-frame camera scaling). The whole combined gizmo is scaled by `globalScale`
 * so its on-screen footprint stays in line with the single-mode gizmos, and the
 * pick bands of the three families are intentionally disjoint so every family
 * keeps a stable hit area:
 *
 *   move   0.17 - 0.45   rotate 0.54 - 0.70   scale 0.81 - 0.99 (center 0 - 0.11)
 */
const TRANSFORM_TOOL_LAYOUT = {
	globalScale: 0.62,
	move: {
		shaftLength: 0.6,
		shaftRadius: 0.0075,
		headBase: 0.6,
		headRadius: 0.045,
		headHeight: 0.1,
		pickCenter: 0.5,
		pickLength: 0.44,
		pickRadius: 0.16
	},
	rotate: {
		ringRadius: 1,
		ringTube: 0.0075,
		pickTube: 0.13,
		// Half angle (degrees in the ring plane) that stays unpickable around every
		// axis crossing so the move/scale handles keep the axis lines.
		pickGapDegrees: 14
	},
	scale: {
		handleOffset: 1.45,
		handleSize: 0.1,
		pickSize: 0.3,
		centerSize: 0.11,
		centerPickSize: 0.34
	}
};

class TransformControlsRoot extends Object3D {

	constructor( controls ) {

		super();

		this.isTransformControlsRoot = true;

		this.controls = controls;
		this.visible = false;

	}

	// updateMatrixWorld updates key transformation variables
	updateMatrixWorld( force ) {

		const controls = this.controls;

		if ( controls.object !== undefined ) {

			controls.object.updateMatrixWorld();

			if ( controls.object.parent === null ) {

				console.error( 'TransformControls: The attached 3D object must be a part of the scene graph.' );

			} else {

				controls.object.parent.matrixWorld.decompose( controls._parentPosition, controls._parentQuaternion, controls._parentScale );

			}

			controls.object.matrixWorld.decompose( controls.worldPosition, controls.worldQuaternion, controls._worldScale );

			// Optional pivot override (e.g. for instanced tiling nodes).
			// When present, use this world position for gizmo placement and plane alignment.
			const pivotOverride = controls.object.userData && controls.object.userData.transformControlsPivotWorld;
			if ( pivotOverride && pivotOverride.isVector3 ) {
				controls.worldPosition.copy( pivotOverride );
			}

			controls._parentQuaternionInv.copy( controls._parentQuaternion ).invert();
			controls._worldQuaternionInv.copy( controls.worldQuaternion ).invert();

		}

		controls.camera.updateMatrixWorld();
		controls.camera.matrixWorld.decompose( controls.cameraPosition, controls.cameraQuaternion, controls._cameraScale );

		if ( controls.camera.isOrthographicCamera ) {

			controls.camera.getWorldDirection( controls.eye ).negate();

		} else {

			controls.eye.copy( controls.cameraPosition ).sub( controls.worldPosition ).normalize();

		}

		super.updateMatrixWorld( force );

	}

	dispose() {

		super.dispose();

		this.traverse( function ( child ) {

			if ( child.geometry ) child.geometry.dispose();
			if ( child.material ) child.material.dispose();

		} );

	}

}

class TransformControlsGizmo extends Object3D {

	constructor() {

		super();

		this.isTransformControlsGizmo = true;

		this.type = 'TransformControlsGizmo';

		// shared materials

		const gizmoMaterial = new MeshBasicMaterial( {
			depthTest: false,
			depthWrite: false,
			fog: false,
			toneMapped: false,
			transparent: true
		} );

		const gizmoLineMaterial = new LineBasicMaterial( {
			depthTest: false,
			depthWrite: false,
			fog: false,
			toneMapped: false,
			transparent: true
		} );

		// Make unique material for each axis/color

		const matInvisible = gizmoMaterial.clone();
		matInvisible.opacity = 0.15;

		// Combined 'transform' pickers are closed volumes (cylinders/boxes) that are
		// approached from every direction, so they are raycast from both sides. Front
		// side only picking would drop rays that enter through a culled cap face.
		const matInvisibleDoubleSided = matInvisible.clone();
		matInvisibleDoubleSided.side = DoubleSide;

		const matHelper = gizmoLineMaterial.clone();
		matHelper.opacity = 0.5;

		const matRed = gizmoMaterial.clone();
		matRed.color.setHex( 0xff0000 );

		const matGreen = gizmoMaterial.clone();
		matGreen.color.setHex( 0x00ff00 );

		const matBlue = gizmoMaterial.clone();
		matBlue.color.setHex( 0x0000ff );

		const matRedTransparent = gizmoMaterial.clone();
		matRedTransparent.color.setHex( 0xff0000 );
		matRedTransparent.opacity = 0.5;

		const matGreenTransparent = gizmoMaterial.clone();
		matGreenTransparent.color.setHex( 0x00ff00 );
		matGreenTransparent.opacity = 0.5;

		const matBlueTransparent = gizmoMaterial.clone();
		matBlueTransparent.color.setHex( 0x0000ff );
		matBlueTransparent.opacity = 0.5;

		const matWhiteTransparent = gizmoMaterial.clone();
		matWhiteTransparent.opacity = 0.25;

		const matYellowTransparent = gizmoMaterial.clone();
		matYellowTransparent.color.setHex( 0xffff00 );
		matYellowTransparent.opacity = 0.25;

		const matYellow = gizmoMaterial.clone();
		matYellow.color.setHex( 0xffff00 );

		const matGray = gizmoMaterial.clone();
		matGray.color.setHex( 0x787878 );

		// materials in the below property are configurable via setColors()

		this.materialLib = {
			xAxis: matRed,
			yAxis: matGreen,
			zAxis: matBlue,
			active: matYellow,
			xAxisTransparent: matRedTransparent,
			yAxisTransparent: matGreenTransparent,
			zAxisTransparent: matBlueTransparent,
			activeTransparent: matYellowTransparent
		};

		// reusable geometry

		const arrowGeometry = new CylinderGeometry( 0, 0.04, 0.1, 12 );
		arrowGeometry.translate( 0, 0.05, 0 );

		const scaleHandleGeometry = new BoxGeometry( 0.08, 0.08, 0.08 );
		scaleHandleGeometry.translate( 0, 0.04, 0 );

		const lineGeometry = new BufferGeometry();
		lineGeometry.setAttribute( 'position', new Float32BufferAttribute( [ 0, 0, 0,	1, 0, 0 ], 3 ) );

		const lineGeometry2 = new CylinderGeometry( 0.0075, 0.0075, 0.5, 3 );
		lineGeometry2.translate( 0, 0.25, 0 );

		function CircleGeometry( radius, arc ) {

			const geometry = new TorusGeometry( radius, 0.0075, 3, 64, arc * Math.PI * 2 );
			geometry.rotateY( Math.PI / 2 );
			geometry.rotateX( Math.PI / 2 );
			return geometry;

		}

		// reusable geometry for the combined 'transform' gizmo

		const transformShaftGeometry = new CylinderGeometry(
			TRANSFORM_TOOL_LAYOUT.move.shaftRadius,
			TRANSFORM_TOOL_LAYOUT.move.shaftRadius,
			TRANSFORM_TOOL_LAYOUT.move.shaftLength,
			3
		);
		transformShaftGeometry.translate( 0, TRANSFORM_TOOL_LAYOUT.move.shaftLength / 2, 0 );

		const transformArrowGeometry = new CylinderGeometry(
			0,
			TRANSFORM_TOOL_LAYOUT.move.headRadius,
			TRANSFORM_TOOL_LAYOUT.move.headHeight,
			12
		);
		transformArrowGeometry.translate( 0, TRANSFORM_TOOL_LAYOUT.move.headHeight / 2, 0 );

		const transformMovePickGeometry = new CylinderGeometry(
			TRANSFORM_TOOL_LAYOUT.move.pickRadius,
			TRANSFORM_TOOL_LAYOUT.move.pickRadius,
			TRANSFORM_TOOL_LAYOUT.move.pickLength,
			4
		);

		const transformRingGeometry = new TorusGeometry(
			TRANSFORM_TOOL_LAYOUT.rotate.ringRadius,
			TRANSFORM_TOOL_LAYOUT.rotate.ringTube,
			3,
			64
		);

		// A full ring crosses the two other axes, and those crossing points sit right
		// on the move/scale pick bands of those axes. Looking along an axis would then
		// always grab the ring instead of the arrow at the tip. The ring *pickers* are
		// therefore built from four arcs that leave a small gap around every crossing,
		// while the visible ring stays a full circle.
		const RING_PICK_GAP = Math.PI * TRANSFORM_TOOL_LAYOUT.rotate.pickGapDegrees / 180;
		const RING_PICK_ARC = Math.PI / 2 - 2 * RING_PICK_GAP;

		function createRingPickEntries( material, orientation ) {

			const entries = [];

			for ( let i = 0; i < 4; i ++ ) {

				const geometry = new TorusGeometry(
					TRANSFORM_TOOL_LAYOUT.rotate.ringRadius,
					TRANSFORM_TOOL_LAYOUT.rotate.pickTube,
					6,
					24,
					RING_PICK_ARC
				);
				geometry.rotateZ( RING_PICK_GAP + i * Math.PI / 2 );

				entries.push( [ new Mesh( geometry, material ), null, orientation ] );

			}

			return entries;

		}

		const transformScaleHandleGeometry = new BoxGeometry(
			TRANSFORM_TOOL_LAYOUT.scale.handleSize,
			TRANSFORM_TOOL_LAYOUT.scale.handleSize,
			TRANSFORM_TOOL_LAYOUT.scale.handleSize
		);

		const transformScalePickGeometry = new BoxGeometry(
			TRANSFORM_TOOL_LAYOUT.scale.pickSize,
			TRANSFORM_TOOL_LAYOUT.scale.pickSize,
			TRANSFORM_TOOL_LAYOUT.scale.pickSize
		);

		const transformScaleCenterGeometry = new BoxGeometry(
			TRANSFORM_TOOL_LAYOUT.scale.centerSize,
			TRANSFORM_TOOL_LAYOUT.scale.centerSize,
			TRANSFORM_TOOL_LAYOUT.scale.centerSize
		);

		const transformScaleCenterPickGeometry = new BoxGeometry(
			TRANSFORM_TOOL_LAYOUT.scale.centerPickSize,
			TRANSFORM_TOOL_LAYOUT.scale.centerPickSize,
			TRANSFORM_TOOL_LAYOUT.scale.centerPickSize
		);

		// Special geometry for transform helper. If scaled with position vector it spans from [0,0,0] to position

		function TranslateHelperGeometry() {

			const geometry = new BufferGeometry();

			geometry.setAttribute( 'position', new Float32BufferAttribute( [ 0, 0, 0, 1, 1, 1 ], 3 ) );

			return geometry;

		}

		// Gizmo definitions - custom hierarchy definitions for setupGizmo() function

		const gizmoTranslate = {
			X: [
				[ new Mesh( arrowGeometry, matRed ), [ 0.5, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( arrowGeometry, matRed ), [ - 0.5, 0, 0 ], [ 0, 0, Math.PI / 2 ]],
				[ new Mesh( lineGeometry2, matRed ), [ 0, 0, 0 ], [ 0, 0, - Math.PI / 2 ]]
			],
			Y: [
				[ new Mesh( arrowGeometry, matGreen ), [ 0, 0.5, 0 ]],
				[ new Mesh( arrowGeometry, matGreen ), [ 0, - 0.5, 0 ], [ Math.PI, 0, 0 ]],
				[ new Mesh( lineGeometry2, matGreen ) ]
			],
			Z: [
				[ new Mesh( arrowGeometry, matBlue ), [ 0, 0, 0.5 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( arrowGeometry, matBlue ), [ 0, 0, - 0.5 ], [ - Math.PI / 2, 0, 0 ]],
				[ new Mesh( lineGeometry2, matBlue ), null, [ -Math.PI / 2, 0, 0 ]]
			],
			XYZ: [
				[ new Mesh( new OctahedronGeometry( 0.1, 0 ), matWhiteTransparent ), [ 0, 0, 0 ]]
			],
			XY: [
				[ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matBlueTransparent ), [ 0.15, 0.15, 0 ]]
			],
			YZ: [
				[ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matRedTransparent ), [ 0, 0.15, 0.15 ], [ 0, Math.PI / 2, 0 ]]
			],
			XZ: [
				[ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matGreenTransparent ), [ 0.15, 0, 0.15 ], [ - Math.PI / 2, 0, 0 ]]
			]
		};

		const pickerTranslate = {
			X: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0.3, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ - 0.3, 0, 0 ], [ 0, 0, Math.PI / 2 ]]
			],
			Y: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0.3, 0 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, - 0.3, 0 ], [ 0, 0, Math.PI ]]
			],
			Z: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0, 0.3 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0, - 0.3 ], [ - Math.PI / 2, 0, 0 ]]
			],
			XYZ: [
				[ new Mesh( new OctahedronGeometry( 0.2, 0 ), matInvisible ) ]
			],
			XY: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0.15, 0.15, 0 ]]
			],
			YZ: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0, 0.15, 0.15 ], [ 0, Math.PI / 2, 0 ]]
			],
			XZ: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0.15, 0, 0.15 ], [ - Math.PI / 2, 0, 0 ]]
			]
		};

		const helperTranslate = {
			START: [
				[ new Mesh( new OctahedronGeometry( 0.01, 2 ), matHelper ), null, null, null, 'helper' ]
			],
			END: [
				[ new Mesh( new OctahedronGeometry( 0.01, 2 ), matHelper ), null, null, null, 'helper' ]
			],
			DELTA: [
				[ new Line( TranslateHelperGeometry(), matHelper ), null, null, null, 'helper' ]
			],
			X: [
				[ new Line( lineGeometry, matHelper ), [ - 1e3, 0, 0 ], null, [ 1e6, 1, 1 ], 'helper' ]
			],
			Y: [
				[ new Line( lineGeometry, matHelper ), [ 0, - 1e3, 0 ], [ 0, 0, Math.PI / 2 ], [ 1e6, 1, 1 ], 'helper' ]
			],
			Z: [
				[ new Line( lineGeometry, matHelper ), [ 0, 0, - 1e3 ], [ 0, - Math.PI / 2, 0 ], [ 1e6, 1, 1 ], 'helper' ]
			]
		};

		const gizmoRotate = {
			XYZE: [
				[ new Mesh( CircleGeometry( 0.5, 1 ), matGray ), null, [ 0, Math.PI / 2, 0 ]]
			],
			X: [
				[ new Mesh( CircleGeometry( 0.5, 0.5 ), matRed ) ]
			],
			Y: [
				[ new Mesh( CircleGeometry( 0.5, 0.5 ), matGreen ), null, [ 0, 0, - Math.PI / 2 ]]
			],
			Z: [
				[ new Mesh( CircleGeometry( 0.5, 0.5 ), matBlue ), null, [ 0, Math.PI / 2, 0 ]]
			],
			E: [
				[ new Mesh( CircleGeometry( 0.75, 1 ), matYellowTransparent ), null, [ 0, Math.PI / 2, 0 ]]
			]
		};

		const helperRotate = {
			AXIS: [
				[ new Line( lineGeometry, matHelper ), [ - 1e3, 0, 0 ], null, [ 1e6, 1, 1 ], 'helper' ]
			]
		};

		const pickerRotate = {
			XYZE: [
				[ new Mesh( new SphereGeometry( 0.25, 10, 8 ), matInvisible ) ]
			],
			X: [
				[ new Mesh( new TorusGeometry( 0.5, 0.1, 4, 24 ), matInvisible ), [ 0, 0, 0 ], [ 0, - Math.PI / 2, - Math.PI / 2 ]],
			],
			Y: [
				[ new Mesh( new TorusGeometry( 0.5, 0.1, 4, 24 ), matInvisible ), [ 0, 0, 0 ], [ Math.PI / 2, 0, 0 ]],
			],
			Z: [
				[ new Mesh( new TorusGeometry( 0.5, 0.1, 4, 24 ), matInvisible ), [ 0, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
			],
			E: [
				[ new Mesh( new TorusGeometry( 0.75, 0.1, 2, 24 ), matInvisible ) ]
			]
		};

		const gizmoScale = {
			X: [
				[ new Mesh( scaleHandleGeometry, matRed ), [ 0.5, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( lineGeometry2, matRed ), [ 0, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( scaleHandleGeometry, matRed ), [ - 0.5, 0, 0 ], [ 0, 0, Math.PI / 2 ]],
			],
			Y: [
				[ new Mesh( scaleHandleGeometry, matGreen ), [ 0, 0.5, 0 ]],
				[ new Mesh( lineGeometry2, matGreen ) ],
				[ new Mesh( scaleHandleGeometry, matGreen ), [ 0, - 0.5, 0 ], [ 0, 0, Math.PI ]],
			],
			Z: [
				[ new Mesh( scaleHandleGeometry, matBlue ), [ 0, 0, 0.5 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( lineGeometry2, matBlue ), [ 0, 0, 0 ], [ -Math.PI / 2, 0, 0 ]],
				[ new Mesh( scaleHandleGeometry, matBlue ), [ 0, 0, - 0.5 ], [ - Math.PI / 2, 0, 0 ]]
			],
			XY: [
				[ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matBlueTransparent ), [ 0.15, 0.15, 0 ]]
			],
			YZ: [
				[ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matRedTransparent ), [ 0, 0.15, 0.15 ], [ 0, Math.PI / 2, 0 ]]
			],
			XZ: [
				[ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matGreenTransparent ), [ 0.15, 0, 0.15 ], [ - Math.PI / 2, 0, 0 ]]
			],
			XYZ: [
				[ new Mesh( new BoxGeometry( 0.1, 0.1, 0.1 ), matWhiteTransparent ) ],
			]
		};

		const pickerScale = {
			X: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0.3, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ - 0.3, 0, 0 ], [ 0, 0, Math.PI / 2 ]]
			],
			Y: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0.3, 0 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, - 0.3, 0 ], [ 0, 0, Math.PI ]]
			],
			Z: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0, 0.3 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0, - 0.3 ], [ - Math.PI / 2, 0, 0 ]]
			],
			XY: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0.15, 0.15, 0 ]],
			],
			YZ: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0, 0.15, 0.15 ], [ 0, Math.PI / 2, 0 ]],
			],
			XZ: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0.15, 0, 0.15 ], [ - Math.PI / 2, 0, 0 ]],
			],
			XYZ: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.2 ), matInvisible ), [ 0, 0, 0 ]],
			]
		};

		const helperScale = {
			X: [
				[ new Line( lineGeometry, matHelper ), [ - 1e3, 0, 0 ], null, [ 1e6, 1, 1 ], 'helper' ]
			],
			Y: [
				[ new Line( lineGeometry, matHelper ), [ 0, - 1e3, 0 ], [ 0, 0, Math.PI / 2 ], [ 1e6, 1, 1 ], 'helper' ]
			],
			Z: [
				[ new Line( lineGeometry, matHelper ), [ 0, 0, - 1e3 ], [ 0, - Math.PI / 2, 0 ], [ 1e6, 1, 1 ], 'helper' ]
			]
		};

		// Combined 'transform' mode: move arrows + rotate rings + scale handles.
		// Unlike the single-mode gizmos the families live at different radii so they
		// can coexist without fighting for the same ray hits.

		const SCALE_HANDLE_OFFSET = TRANSFORM_TOOL_LAYOUT.scale.handleOffset;
		const MOVE_HEAD_BASE = TRANSFORM_TOOL_LAYOUT.move.headBase;
		const MOVE_PICK_CENTER = TRANSFORM_TOOL_LAYOUT.move.pickCenter;

		const gizmoTransformMove = {
			X: [
				[ new Mesh( transformShaftGeometry, matRed ), null, [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( transformShaftGeometry, matRed ), null, [ 0, 0, Math.PI / 2 ]],
				[ new Mesh( transformArrowGeometry, matRed ), [ MOVE_HEAD_BASE, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( transformArrowGeometry, matRed ), [ - MOVE_HEAD_BASE, 0, 0 ], [ 0, 0, Math.PI / 2 ]]
			],
			Y: [
				[ new Mesh( transformShaftGeometry, matGreen ) ],
				[ new Mesh( transformShaftGeometry, matGreen ), null, [ 0, 0, Math.PI ]],
				[ new Mesh( transformArrowGeometry, matGreen ), [ 0, MOVE_HEAD_BASE, 0 ]],
				[ new Mesh( transformArrowGeometry, matGreen ), [ 0, - MOVE_HEAD_BASE, 0 ], [ Math.PI, 0, 0 ]]
			],
			Z: [
				[ new Mesh( transformShaftGeometry, matBlue ), null, [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( transformShaftGeometry, matBlue ), null, [ - Math.PI / 2, 0, 0 ]],
				[ new Mesh( transformArrowGeometry, matBlue ), [ 0, 0, MOVE_HEAD_BASE ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( transformArrowGeometry, matBlue ), [ 0, 0, - MOVE_HEAD_BASE ], [ - Math.PI / 2, 0, 0 ]]
			]
		};

		const pickerTransformMove = {
			X: [
				[ new Mesh( transformMovePickGeometry, matInvisibleDoubleSided ), [ MOVE_PICK_CENTER, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( transformMovePickGeometry, matInvisibleDoubleSided ), [ - MOVE_PICK_CENTER, 0, 0 ], [ 0, 0, Math.PI / 2 ]]
			],
			Y: [
				[ new Mesh( transformMovePickGeometry, matInvisibleDoubleSided ), [ 0, MOVE_PICK_CENTER, 0 ]],
				[ new Mesh( transformMovePickGeometry, matInvisibleDoubleSided ), [ 0, - MOVE_PICK_CENTER, 0 ]]
			],
			Z: [
				[ new Mesh( transformMovePickGeometry, matInvisibleDoubleSided ), [ 0, 0, MOVE_PICK_CENTER ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( transformMovePickGeometry, matInvisibleDoubleSided ), [ 0, 0, - MOVE_PICK_CENTER ], [ - Math.PI / 2, 0, 0 ]]
			]
		};

		const gizmoTransformRotate = {
			X: [
				[ new Mesh( transformRingGeometry, matRed ), null, [ 0, - Math.PI / 2, 0 ]]
			],
			Y: [
				[ new Mesh( transformRingGeometry, matGreen ), null, [ Math.PI / 2, 0, 0 ]]
			],
			Z: [
				[ new Mesh( transformRingGeometry, matBlue )]
			]
		};

		const pickerTransformRotate = {
			X: createRingPickEntries( matInvisibleDoubleSided, [ 0, - Math.PI / 2, 0 ] ),
			Y: createRingPickEntries( matInvisibleDoubleSided, [ Math.PI / 2, 0, 0 ] ),
			Z: createRingPickEntries( matInvisibleDoubleSided, null )
		};

		const gizmoTransformScale = {
			X: [
				[ new Mesh( transformScaleHandleGeometry, matRed ), [ SCALE_HANDLE_OFFSET, 0, 0 ]],
				[ new Mesh( transformScaleHandleGeometry, matRed ), [ - SCALE_HANDLE_OFFSET, 0, 0 ]]
			],
			Y: [
				[ new Mesh( transformScaleHandleGeometry, matGreen ), [ 0, SCALE_HANDLE_OFFSET, 0 ]],
				[ new Mesh( transformScaleHandleGeometry, matGreen ), [ 0, - SCALE_HANDLE_OFFSET, 0 ]]
			],
			Z: [
				[ new Mesh( transformScaleHandleGeometry, matBlue ), [ 0, 0, SCALE_HANDLE_OFFSET ]],
				[ new Mesh( transformScaleHandleGeometry, matBlue ), [ 0, 0, - SCALE_HANDLE_OFFSET ]]
			],
			XYZ: [
				[ new Mesh( transformScaleCenterGeometry, matWhiteTransparent )]
			]
		};

		const pickerTransformScale = {
			X: [
				[ new Mesh( transformScalePickGeometry, matInvisibleDoubleSided ), [ SCALE_HANDLE_OFFSET, 0, 0 ]],
				[ new Mesh( transformScalePickGeometry, matInvisibleDoubleSided ), [ - SCALE_HANDLE_OFFSET, 0, 0 ]]
			],
			Y: [
				[ new Mesh( transformScalePickGeometry, matInvisibleDoubleSided ), [ 0, SCALE_HANDLE_OFFSET, 0 ]],
				[ new Mesh( transformScalePickGeometry, matInvisibleDoubleSided ), [ 0, - SCALE_HANDLE_OFFSET, 0 ]]
			],
			Z: [
				[ new Mesh( transformScalePickGeometry, matInvisibleDoubleSided ), [ 0, 0, SCALE_HANDLE_OFFSET ]],
				[ new Mesh( transformScalePickGeometry, matInvisibleDoubleSided ), [ 0, 0, - SCALE_HANDLE_OFFSET ]]
			],
			XYZ: [
				[ new Mesh( transformScaleCenterPickGeometry, matInvisibleDoubleSided )]
			]
		};

		// Creates an Object3D with gizmos described in custom hierarchy definition.

		function setupGizmo( gizmoMap, family ) {

			const gizmo = new Object3D();

			for ( const name in gizmoMap ) {

				for ( let i = gizmoMap[ name ].length; i --; ) {

					const object = gizmoMap[ name ][ i ][ 0 ].clone();
					const position = gizmoMap[ name ][ i ][ 1 ];
					const rotation = gizmoMap[ name ][ i ][ 2 ];
					const scale = gizmoMap[ name ][ i ][ 3 ];
					const tag = gizmoMap[ name ][ i ][ 4 ];

					// name and tag properties are essential for picking and updating logic.
					object.name = name;
					object.tag = tag;
					// `family` is only set for the combined 'transform' handles so the
					// shared update loop can tell move/rotate/scale handles apart.
					object.family = family;

					if ( position ) {

						object.position.set( position[ 0 ], position[ 1 ], position[ 2 ] );

					}

					if ( rotation ) {

						object.rotation.set( rotation[ 0 ], rotation[ 1 ], rotation[ 2 ] );

					}

					if ( scale ) {

						object.scale.set( scale[ 0 ], scale[ 1 ], scale[ 2 ] );

					}

					object.updateMatrix();

					const tempGeometry = object.geometry.clone();
					tempGeometry.applyMatrix4( object.matrix );
					object.geometry = tempGeometry;
					object.renderOrder = Infinity;

					object.position.set( 0, 0, 0 );
					object.rotation.set( 0, 0, 0 );
					object.scale.set( 1, 1, 1 );

					gizmo.add( object );

				}

			}

			return gizmo;

		}

		// Builds a flat gizmo group whose handles carry their own `family` tag, so the
		// combined 'transform' mode can mix move/rotate/scale handles in one group.

		function setupTransformGizmo( familyMaps ) {

			const gizmo = new Object3D();

			for ( const family in familyMaps ) {

				const familyGizmo = setupGizmo( familyMaps[ family ], family );

				for ( let i = familyGizmo.children.length; i --; ) {

					gizmo.add( familyGizmo.children[ i ] );

				}

			}

			return gizmo;

		}

		// Gizmo creation

		this.gizmo = {};
		this.picker = {};
		this.helper = {};

		this.add( this.gizmo[ 'translate' ] = setupGizmo( gizmoTranslate ) );
		this.add( this.gizmo[ 'rotate' ] = setupGizmo( gizmoRotate ) );
		this.add( this.gizmo[ 'scale' ] = setupGizmo( gizmoScale ) );
		this.add( this.picker[ 'translate' ] = setupGizmo( pickerTranslate ) );
		this.add( this.picker[ 'rotate' ] = setupGizmo( pickerRotate ) );
		this.add( this.picker[ 'scale' ] = setupGizmo( pickerScale ) );
		this.add( this.helper[ 'translate' ] = setupGizmo( helperTranslate ) );
		this.add( this.helper[ 'rotate' ] = setupGizmo( helperRotate ) );
		this.add( this.helper[ 'scale' ] = setupGizmo( helperScale ) );

		this.add( this.gizmo[ 'transform' ] = setupTransformGizmo( {
			translate: gizmoTransformMove,
			rotate: gizmoTransformRotate,
			scale: gizmoTransformScale
		} ) );
		this.add( this.picker[ 'transform' ] = setupTransformGizmo( {
			translate: pickerTransformMove,
			rotate: pickerTransformRotate,
			scale: pickerTransformScale
		} ) );
		this.add( this.helper[ 'transform' ] = setupTransformGizmo( {
			translate: helperTranslate
		} ) );

		// Pickers should be hidden always

		this.picker[ 'translate' ].visible = false;
		this.picker[ 'rotate' ].visible = false;
		this.picker[ 'scale' ].visible = false;
		this.picker[ 'transform' ].visible = false;

	}

	// updateMatrixWorld will update transformations and appearance of individual handles

	updateMatrixWorld( force ) {

		const isCombined = this.mode === 'transform';
		const activeFamilies = isCombined ? this.transformFamilies : [ this.mode ];
		const activeGroup = isCombined ? 'transform' : this.mode;
		const handleScaleFactor = ( isCombined ? TRANSFORM_TOOL_LAYOUT.globalScale : 1 );

		// Show only gizmos for current transform mode

		this.gizmo[ 'translate' ].visible = this.mode === 'translate';
		this.gizmo[ 'rotate' ].visible = this.mode === 'rotate';
		this.gizmo[ 'scale' ].visible = this.mode === 'scale';
		this.gizmo[ 'transform' ].visible = isCombined;

		this.helper[ 'translate' ].visible = this.mode === 'translate';
		this.helper[ 'rotate' ].visible = this.mode === 'rotate';
		this.helper[ 'scale' ].visible = this.mode === 'scale';
		this.helper[ 'transform' ].visible = isCombined;


		let handles = [];
		handles = handles.concat( this.picker[ activeGroup ].children );
		handles = handles.concat( this.gizmo[ activeGroup ].children );
		handles = handles.concat( this.helper[ activeGroup ].children );

		for ( let i = 0; i < handles.length; i ++ ) {

			const handle = handles[ i ];

			// The combined mode mixes handle families in one group; single modes fall
			// back to the current mode so their behavior is unchanged.
			const family = handle.family !== undefined ? handle.family : this.mode;
			const familySpace = ( family === 'scale' ) ? 'local' : this.space; // scale always oriented to local rotation
			const quaternion = ( familySpace === 'local' ) ? this.worldQuaternion : _identityQuaternion;

			// Hide handles of families that are currently not available for the selection.
			if ( activeFamilies.indexOf( family ) === - 1 ) {

				handle.visible = false;
				continue;

			}

			// hide aligned to camera

			handle.visible = true;
			handle.rotation.set( 0, 0, 0 );
			handle.position.copy( this.worldPosition );

			let factor;

			if ( this.camera.isOrthographicCamera ) {

				factor = ( this.camera.top - this.camera.bottom ) / this.camera.zoom;

			} else {

				factor = this.worldPosition.distanceTo( this.cameraPosition ) * Math.min( 1.9 * Math.tan( Math.PI * this.camera.fov / 360 ) / this.camera.zoom, 7 );

			}

			handle.scale.set( 1, 1, 1 ).multiplyScalar( factor * this.size / 4 * handleScaleFactor );

			// TODO: simplify helpers and consider decoupling from gizmo

			if ( handle.tag === 'helper' ) {

				handle.visible = false;

				// Helpers describe the drag of a single family, so only show them while
				// that family is the one being interacted with.
				if ( isCombined && family !== this.interactionMode ) {

					continue;

				}

				if ( handle.name === 'AXIS' ) {

					handle.visible = !! this.axis;

					if ( this.axis === 'X' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, 0, 0 ) );
						handle.quaternion.copy( quaternion ).multiply( _tempQuaternion );

						if ( Math.abs( _alignVector.copy( _unitX ).applyQuaternion( quaternion ).dot( this.eye ) ) > 0.9 ) {

							handle.visible = false;

						}

					}

					if ( this.axis === 'Y' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, 0, Math.PI / 2 ) );
						handle.quaternion.copy( quaternion ).multiply( _tempQuaternion );

						if ( Math.abs( _alignVector.copy( _unitY ).applyQuaternion( quaternion ).dot( this.eye ) ) > 0.9 ) {

							handle.visible = false;

						}

					}

					if ( this.axis === 'Z' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, Math.PI / 2, 0 ) );
						handle.quaternion.copy( quaternion ).multiply( _tempQuaternion );

						if ( Math.abs( _alignVector.copy( _unitZ ).applyQuaternion( quaternion ).dot( this.eye ) ) > 0.9 ) {

							handle.visible = false;

						}

					}

					if ( this.axis === 'XYZE' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, Math.PI / 2, 0 ) );
						_alignVector.copy( this.rotationAxis );
						handle.quaternion.setFromRotationMatrix( _lookAtMatrix.lookAt( _zeroVector, _alignVector, _unitY ) );
						handle.quaternion.multiply( _tempQuaternion );
						handle.visible = this.dragging;

					}

					if ( this.axis === 'E' ) {

						handle.visible = false;

					}


				} else if ( handle.name === 'START' ) {

					handle.position.copy( this.worldPositionStart );
					handle.visible = this.dragging;

				} else if ( handle.name === 'END' ) {

					handle.position.copy( this.worldPosition );
					handle.visible = this.dragging;

				} else if ( handle.name === 'DELTA' ) {

					handle.position.copy( this.worldPositionStart );
					handle.quaternion.copy( this.worldQuaternionStart );
					_tempVector.set( 1e-10, 1e-10, 1e-10 ).add( this.worldPositionStart ).sub( this.worldPosition ).multiplyScalar( - 1 );
					_tempVector.applyQuaternion( this.worldQuaternionStart.clone().invert() );
					handle.scale.copy( _tempVector );
					handle.visible = this.dragging;

				} else {

					handle.quaternion.copy( quaternion );

					if ( this.dragging ) {

						handle.position.copy( this.worldPositionStart );

					} else {

						handle.position.copy( this.worldPosition );

					}

					if ( this.axis ) {

						handle.visible = this.axis.search( handle.name ) !== - 1;

					}

				}

				// If updating helper, skip rest of the loop
				continue;

			}

			// Align handles to current local or world rotation

			handle.quaternion.copy( quaternion );

			if ( family === 'translate' || family === 'scale' ) {

				// Hide translate and scale axis facing the camera

				const AXIS_HIDE_THRESHOLD = 0.99;
				const PLANE_HIDE_THRESHOLD = 0.2;

				if ( handle.name === 'X' ) {

					if ( Math.abs( _alignVector.copy( _unitX ).applyQuaternion( quaternion ).dot( this.eye ) ) > AXIS_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'Y' ) {

					if ( Math.abs( _alignVector.copy( _unitY ).applyQuaternion( quaternion ).dot( this.eye ) ) > AXIS_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'Z' ) {

					if ( Math.abs( _alignVector.copy( _unitZ ).applyQuaternion( quaternion ).dot( this.eye ) ) > AXIS_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'XY' ) {

					if ( Math.abs( _alignVector.copy( _unitZ ).applyQuaternion( quaternion ).dot( this.eye ) ) < PLANE_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'YZ' ) {

					if ( Math.abs( _alignVector.copy( _unitX ).applyQuaternion( quaternion ).dot( this.eye ) ) < PLANE_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'XZ' ) {

					if ( Math.abs( _alignVector.copy( _unitY ).applyQuaternion( quaternion ).dot( this.eye ) ) < PLANE_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

			} else if ( family === 'rotate' ) {

				// Align handles to current local or world rotation

				_tempQuaternion2.copy( quaternion );
				_alignVector.copy( this.eye ).applyQuaternion( _tempQuaternion.copy( quaternion ).invert() );

				if ( handle.name.search( 'E' ) !== - 1 ) {

					handle.quaternion.setFromRotationMatrix( _lookAtMatrix.lookAt( this.eye, _zeroVector, _unitY ) );

				}

				if ( handle.name === 'X' ) {

					_tempQuaternion.setFromAxisAngle( _unitX, Math.atan2( - _alignVector.y, _alignVector.z ) );
					_tempQuaternion.multiplyQuaternions( _tempQuaternion2, _tempQuaternion );
					handle.quaternion.copy( _tempQuaternion );

				}

				if ( handle.name === 'Y' ) {

					_tempQuaternion.setFromAxisAngle( _unitY, Math.atan2( _alignVector.x, _alignVector.z ) );
					_tempQuaternion.multiplyQuaternions( _tempQuaternion2, _tempQuaternion );
					handle.quaternion.copy( _tempQuaternion );

				}

				if ( handle.name === 'Z' ) {

					_tempQuaternion.setFromAxisAngle( _unitZ, Math.atan2( _alignVector.y, _alignVector.x ) );
					_tempQuaternion.multiplyQuaternions( _tempQuaternion2, _tempQuaternion );
					handle.quaternion.copy( _tempQuaternion );

				}

			}

			// Hide disabled axes
			handle.visible = handle.visible && ( handle.name.indexOf( 'X' ) === - 1 || this.showX );
			handle.visible = handle.visible && ( handle.name.indexOf( 'Y' ) === - 1 || this.showY );
			handle.visible = handle.visible && ( handle.name.indexOf( 'Z' ) === - 1 || this.showZ );
			handle.visible = handle.visible && ( handle.name.indexOf( 'E' ) === - 1 || ( this.showX && this.showY && this.showZ ) );

			// highlight selected axis

			handle.material._color = handle.material._color || handle.material.color.clone();
			handle.material._opacity = handle.material._opacity || handle.material.opacity;

			handle.material.color.copy( handle.material._color );
			handle.material.opacity = handle.material._opacity;

			if ( this.enabled && this.axis ) {

				if ( handle.name === this.axis ) {

					handle.material.color.copy( this.materialLib.active.color );
					handle.material.opacity = 1.0;

				} else if ( this.axis.split( '' ).some( function ( a ) {

					return handle.name === a;

				} ) ) {

					handle.material.color.copy( this.materialLib.active.color );
					handle.material.opacity = 1.0;

				}

			}

		}

		super.updateMatrixWorld( force );

	}

}

//

class TransformControlsPlane extends Mesh {

	constructor() {

		super(
			new PlaneGeometry( 100000, 100000, 2, 2 ),
			new MeshBasicMaterial( { visible: false, wireframe: true, side: DoubleSide, transparent: true, opacity: 0.1, toneMapped: false } )
		);

		this.isTransformControlsPlane = true;

		this.type = 'TransformControlsPlane';

	}

	updateMatrixWorld( force ) {

		let space = this.space;

		this.position.copy( this.worldPosition );

		// The combined 'transform' mode aligns the drag plane with the family that is
		// currently being interacted with.
		const mode = ( this.mode === 'transform' ) ? this.interactionMode : this.mode;

		if ( mode === 'scale' ) space = 'local'; // scale always oriented to local rotation

		_v1.copy( _unitX ).applyQuaternion( space === 'local' ? this.worldQuaternion : _identityQuaternion );
		_v2.copy( _unitY ).applyQuaternion( space === 'local' ? this.worldQuaternion : _identityQuaternion );
		_v3.copy( _unitZ ).applyQuaternion( space === 'local' ? this.worldQuaternion : _identityQuaternion );

		// Align the plane for current transform mode, axis and space.

		_alignVector.copy( _v2 );

		switch ( mode ) {

			case 'translate':
			case 'scale':
				switch ( this.axis ) {

					case 'X':
						_alignVector.copy( this.eye ).cross( _v1 );
						_dirVector.copy( _v1 ).cross( _alignVector );
						break;
					case 'Y':
						_alignVector.copy( this.eye ).cross( _v2 );
						_dirVector.copy( _v2 ).cross( _alignVector );
						break;
					case 'Z':
						_alignVector.copy( this.eye ).cross( _v3 );
						_dirVector.copy( _v3 ).cross( _alignVector );
						break;
					case 'XY':
						_dirVector.copy( _v3 );
						break;
					case 'YZ':
						_dirVector.copy( _v1 );
						break;
					case 'XZ':
						_alignVector.copy( _v3 );
						_dirVector.copy( _v2 );
						break;
					case 'XYZ':
					case 'E':
						_dirVector.set( 0, 0, 0 );
						break;

				}

				break;
			case 'rotate':
			default:
				// special case for rotate
				_dirVector.set( 0, 0, 0 );

		}

		if ( _dirVector.length() === 0 ) {

			// If in rotate mode, make the plane parallel to camera
			this.quaternion.copy( this.cameraQuaternion );

		} else {

			_tempMatrix.lookAt( _tempVector.set( 0, 0, 0 ), _dirVector, _alignVector );

			this.quaternion.setFromRotationMatrix( _tempMatrix );

		}

		super.updateMatrixWorld( force );

	}

}

export { TransformControls, TransformControlsGizmo, TransformControlsPlane };
