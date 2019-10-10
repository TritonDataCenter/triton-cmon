pipeline {

    agent {
        label '!platform:true && image_ver:18.4.0 && pkgsrc_arch:x86_64 && pi:20151126T062538Z && jenkins_agent:2'
    }

    options {
        timestamps()
    }

    stages {
        stage('check') {
            steps{
                sh('make check')
            }
        }
    }
}
