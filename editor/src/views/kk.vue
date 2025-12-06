<template>
    <canvas ref="cannonDemo" class="cannonDemo">
    </canvas>
</template>

<script setup>
import { onMounted, ref } from "vue"
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
const cannonDemo = ref('null')

onMounted(() => {
    const cannonDemoDomWidth = cannonDemo.value.offsetWidth
    const cannonDemoDomHeight = cannonDemo.value.offsetHeight

    // 创建场景
    const scene = new THREE.Scene
    // 创建相机
    const camera = new THREE.PerspectiveCamera( // 透视相机
        45, // 视角 角度数
        cannonDemoDomWidth / cannonDemoDomHeight, // 宽高比 占据屏幕
        0.1, // 近平面（相机最近能看到物体）
        1000, // 远平面（相机最远能看到物体）
    )
    camera.position.set(0, 2, 30)
    // 创建渲染器
    const renderer = new THREE.WebGLRenderer({
        antialias: true, // 抗锯齿
        canvas: cannonDemo.value
    })
    // 设置设备像素比
    renderer.setPixelRatio(window.devicePixelRatio)
    // 设置画布尺寸
    renderer.setSize(cannonDemoDomWidth, cannonDemoDomHeight)

    const light = new THREE.AmbientLight(0x404040, 200); // 柔和的白光
    scene.add(light);

    let meshes = []
    let phyMeshes = []
    const physicsWorld = new CANNON.World()
    // 设置y轴重力
    physicsWorld.gravity.set(0, -9.82, 0)

    const planeBody = new CANNON.Body({
        shape: new CANNON.Box(new CANNON.Vec3(50, 0.1, 50)),
        mass: 0,
        position: new CANNON.Vec3(0, 0, 0)
    })
    physicsWorld.addBody(planeBody)
    phyMeshes.push(planeBody)

    const planeGeometry = new THREE.BoxGeometry(100, 0.2, 100)
    const planeMaterial = new THREE.MeshBasicMaterial({ color: 0xE0E0E0 })

    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    scene.add(planeMesh)
    meshes.push(planeMesh)

    // 创建车身
    let chassisShape = new CANNON.Box(new CANNON.Vec3(2, 0.5, 1))
    let chassisBody = new CANNON.Body({
        mass: 150,
        shape: chassisShape,
        position: new CANNON.Vec3(0, 5, 0)
    })
    physicsWorld.addBody(chassisBody)
    phyMeshes.push(chassisBody)

    // 创建视图车身
    let chassisMesh = new THREE.Mesh(
        new THREE.BoxGeometry(4, 1, 2),
        new THREE.MeshBasicMaterial({ color: 0x0000ff })
    )
    scene.add(chassisMesh)
    meshes.push(chassisMesh)

    // 创建复杂车架
    const vehicle = new CANNON.RaycastVehicle({
        chassisBody
    })

    // 车轮配置
    const wheelOptions = {
        // 半径
        radius: 0.5,
        // 车轮垂直哪个轴
        directionLocal: new CANNON.Vec3(0, -1, 0),
        // // 设置悬架刚度
        // suspensionStiffness: 30,
        // // 设置悬架的休息长度
        suspensionRestLength: 0.3,
        // // 设置车轮的滑动摩擦力
        frictionSlip: 1.4,
        // // 悬架拉伸阻尼
        dampingRelaxation: 2.3,
        // // 悬架压缩阻尼 
        dampingCompression: 4.4,
        // // 最大悬架力
        maxSuspensionForce: 100000,
        // // 设置最大的悬架变化
        maxSuspensionTravel: 0.2,
        // 设置车轮的转向轴
        axleLocal: new CANNON.Vec3(0, 0, 1)
    }

    // 添加
    vehicle.addWheel({
        ...wheelOptions,
        // 车轮位置
        chassisConnectionPointLocal: new CANNON.Vec3(-1, -0, 1.15)
    })
    vehicle.addWheel({
        ...wheelOptions,
        // 车轮位置
        chassisConnectionPointLocal: new CANNON.Vec3(-1, -0, -1.15)
    })
    vehicle.addWheel({
        ...wheelOptions,
        // 车轮位置
        chassisConnectionPointLocal: new CANNON.Vec3(1, -0, 1.15)
    })
    vehicle.addWheel({
        ...wheelOptions,
        // 车轮位置
        chassisConnectionPointLocal: new CANNON.Vec3(1, -0, -1.15)
    })

    vehicle.addToWorld(physicsWorld)

    // 车轮形状
    const wheelShape = new CANNON.Cylinder(0.5, 0.5, 0.2, 20);
    const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 20)
    const wheelMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true })

    let wheelBodies = []
    for (let i = 0; i < vehicle.wheelInfos.length; i++) {
     

        const cylinderMesh = new THREE.Mesh(wheelGeometry, wheelMaterial)
        cylinderMesh.rotation.x = -Math.PI / 2
        const wheelObj = new THREE.Object3D()
        wheelObj.add(cylinderMesh)
        scene.add(wheelObj)
        meshes.push(wheelObj)
    }

    physicsWorld.addEventListener('postStep', () => {
        for (let i = 0; i < vehicle.wheelInfos.length; i++) {
            vehicle.updateWheelTransform(i)
            const t = vehicle.wheelInfos[i].worldTransform

        }
    })

    window.addEventListener('keydown', (event) => {
        if (event.key == 'w') {
            vehicle.applyEngineForce(-500, 0)
            vehicle.applyEngineForce(-500, 1)

        }
        if (event.key == 's') {
            vehicle.applyEngineForce(500, 0)
            vehicle.applyEngineForce(500, 1)

        }
        if (event.key == 'a') {
            vehicle.setSteeringValue(Math.PI / 4, 0)
            vehicle.setSteeringValue(Math.PI / 4, 1)

        }
        if (event.key == 'd') {
            vehicle.setSteeringValue(-Math.PI / 4, 0)
            vehicle.setSteeringValue(-Math.PI / 4, 1)
        }
        // 重置
        if (event.key == 'r') {
            chassisBody.velocity.set(0, 0, 0)
            chassisBody.angularVelocity.set(0, 0, 0)
            chassisBody.position.set(0, 10, 0)
        }
        // 制动
        if (event.key == ' ') {
            vehicle.setBrake(100, 0)
            vehicle.setBrake(100, 1)
        }
    })
    window.addEventListener('keyup', (event) => {
        if (event.key == 'w') {
            vehicle.applyEngineForce(0, 0)
            vehicle.applyEngineForce(0, 1)

        }
        if (event.key == 's') {
            vehicle.applyEngineForce(0, 0)
            vehicle.applyEngineForce(0, 1)

        }
        if (event.key == 'a') {
            vehicle.setSteeringValue(0, 0)
            vehicle.setSteeringValue(0, 1)

        }
        if (event.key == 'd') {
            vehicle.setSteeringValue(0, 0)
            vehicle.setSteeringValue(0, 1)

        }
        // 制动
        if (event.key == ' ') {
            vehicle.setBrake(0, 0)
            vehicle.setBrake(0, 1)
        }
    })
    const axesHelper = new THREE.AxesHelper(30);
    scene.add(axesHelper);

    const updatePhysic = () => { // 因为这是实时更新的，所以需要放到渲染循环动画animate函数中
        physicsWorld.step(1 / 60)
        for (let i = 0; i < phyMeshes.length; i++) {
            meshes[i].position.copy(phyMeshes[i].position)
            meshes[i].quaternion.copy(phyMeshes[i].quaternion)
        }
    }

    // 控制器
    const control = new OrbitControls(camera, renderer.domElement)
    // 开启阻尼惯性，默认值为0.05
    control.enableDamping = true

    // 渲染循环动画
    function animate() {
        // 在这里我们创建了一个使渲染器能够在每次屏幕刷新时对场景进行绘制的循环（在大多数屏幕上，刷新率一般是60次/秒）
        requestAnimationFrame(animate)
        updatePhysic()
        // 更新控制器。如果没在动画里加上，那必须在摄像机的变换发生任何手动改变后调用
        control.update()
        renderer.render(scene, camera)
    }

    // 执行动画
    animate()
})

</script>
<style scoped>
.cannonDemo {
    width: 100vw;
    height: 100vh;
}
</style>
